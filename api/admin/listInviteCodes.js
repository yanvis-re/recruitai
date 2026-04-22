// api/admin/listInviteCodes.js
//
// Admin-only: returns every invite code in the system with its metadata
// (uses, maxUses, expiresAt, enabled, note). Used by the AdminPanel to
// render the invite-codes tab.

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
    if ((decoded.email || "").toLowerCase().trim() !== ADMIN_EMAIL.toLowerCase().trim()) { res.status(403).json({ error: "Forbidden" }); return null; }
    return decoded;
  } catch { res.status(401).json({ error: "Invalid token" }); return null; }
}

export default async function handler(req, res) {
  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  try {
    const db = admin.firestore();
    const snap = await db.collection("inviteCodes").get();
    const codes = snap.docs.map(d => ({ code: d.id, ...d.data() }));
    // Newest first
    codes.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return res.status(200).json({ codes });
  } catch (err) {
    console.error("admin/listInviteCodes error:", err);
    return res.status(500).json({ error: err.message });
  }
}
