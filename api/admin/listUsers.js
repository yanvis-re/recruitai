// api/admin/listUsers.js
//
// Admin-only endpoint that returns every recruiter in the system with their
// status, basic stats (process count, candidate count) and timestamps. Used
// by the AdminPanel to render its users table.
//
// Auth: expects 'Authorization: Bearer {idToken}' where idToken is a Firebase
// Auth ID token. The decoded token's email MUST equal ADMIN_EMAIL.
//
// Required Vercel env vars:
//   FIREBASE_SERVICE_ACCOUNT_KEY
//   ADMIN_EMAIL  (defaults to 'yanvis@gmail.com' if unset)

import admin from "firebase-admin";

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); }
    catch (e) { console.error("firebase-admin init error:", e.message); }
  }
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "yanvis@gmail.com";

async function requireAdmin(req, res) {
  if (!admin.apps.length) {
    res.status(500).json({ error: "admin_sdk_not_initialized" });
    return null;
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Missing token" }); return null; }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if ((decoded.email || "").toLowerCase().trim() !== ADMIN_EMAIL.toLowerCase().trim()) {
      res.status(403).json({ error: "Forbidden: not the admin" });
      return null;
    }
    return decoded;
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  try {
    const db = admin.firestore();
    const snap = await db.collection("recruiters").get();

    // For each recruiter, also try to pull their Auth record to get lastSignInTime.
    const users = await Promise.all(snap.docs.map(async (d) => {
      const data = d.data();
      let lastSignInTime = null;
      let authEmail = data.email || "";
      let authName = data.displayName || "";
      try {
        const rec = await admin.auth().getUser(d.id);
        lastSignInTime = rec.metadata?.lastSignInTime || null;
        authEmail = rec.email || authEmail;
        authName = rec.displayName || authName;
      } catch { /* auth user may not exist */ }

      return {
        uid: d.id,
        email: authEmail,
        displayName: authName,
        status: data.status || "active", // legacy docs without status are active
        statusUpdatedAt: data.statusUpdatedAt || null,
        statusNote: data.statusNote || "",
        createdAt: data.createdAt || null,
        lastSignInTime,
        processCount: (data.processes || []).length,
        candidateCount: (data.processes || []).reduce((s, p) => s + (p.candidates?.length || 0), 0),
      };
    }));

    // Newest first by createdAt if present, otherwise by lastSignInTime.
    users.sort((a, b) => {
      const aT = new Date(a.createdAt || a.lastSignInTime || 0).getTime();
      const bT = new Date(b.createdAt || b.lastSignInTime || 0).getTime();
      return bT - aT;
    });

    return res.status(200).json({ users, adminEmail: ADMIN_EMAIL });
  } catch (err) {
    console.error("admin/listUsers error:", err);
    return res.status(500).json({ error: err.message });
  }
}
