// api/admin/updateInviteCode.js
//
// Admin-only: toggles the 'enabled' flag of an existing invite code or
// updates its metadata (maxUses / expiresAt / note). Used to deactivate a
// code without deleting it (keeps the audit trail of who used it).

import admin from "firebase-admin";

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) { try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); } catch (e) { console.error("firebase-admin init:", e.message); } }
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "yanvis@gmail.com";

async function requireAdmin(req, res) {
  if (!admin.apps.length) { res.status(500).json({ error: "service_unavailable" }); return null; }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Missing token" }); return null; }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.email !== ADMIN_EMAIL) { res.status(403).json({ error: "Forbidden" }); return null; }
    return decoded;
  } catch { res.status(401).json({ error: "Invalid token" }); return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  const { code: rawCode, enabled, maxUses, expiresAt, note } = req.body || {};
  const code = (rawCode || "").toString().trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Missing code" });

  try {
    const db = admin.firestore();
    const ref = db.collection("inviteCodes").doc(code);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Code not found" });

    const update = {};
    if (typeof enabled === "boolean") update.enabled = enabled;
    if (maxUses !== undefined) update.maxUses = typeof maxUses === "number" && maxUses > 0 ? maxUses : null;
    if (expiresAt !== undefined) update.expiresAt = expiresAt || null;
    if (typeof note === "string") update.note = note;

    if (Object.keys(update).length === 0) return res.status(400).json({ error: "No fields to update" });

    await ref.set(update, { merge: true });
    const updated = { ...snap.data(), ...update, code };
    return res.status(200).json({ success: true, code: updated });
  } catch (err) {
    console.error("admin/updateInviteCode error:", err);
    return res.status(500).json({ error: err.message });
  }
}
