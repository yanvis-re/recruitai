// api/admin/deleteInviteCode.js
//
// Admin-only: hard-deletes an invite code. NOTE: the users who signed up
// with that code keep their inviteCodeUsed reference but the code doc is
// gone. Prefer toggling 'enabled: false' if you want to keep the audit
// trail — deletion is for mistakes / junk test codes.

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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  const code = (req.body?.code || "").toString().trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Missing code" });

  try {
    const db = admin.firestore();
    await db.collection("inviteCodes").doc(code).delete();
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("admin/deleteInviteCode error:", err);
    return res.status(500).json({ error: err.message });
  }
}
