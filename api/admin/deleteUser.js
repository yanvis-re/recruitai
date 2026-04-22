// api/admin/deleteUser.js
//
// Admin-only endpoint that hard-deletes a recruiter: Firebase Auth user +
// their recruiters/{uid} doc + every publicProcesses/{id} they owned (plus
// subcollections of applications). Destructive and irreversible — the
// client is expected to confirm twice.
//
// Body: { uid }
// Auth: same as listUsers.

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
  if (!admin.apps.length) { res.status(500).json({ error: "admin_sdk_not_initialized" }); return null; }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Missing token" }); return null; }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.email !== ADMIN_EMAIL) { res.status(403).json({ error: "Forbidden" }); return null; }
    return decoded;
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
}

async function deleteCollection(db, collectionRef, batchSize = 50) {
  const snap = await collectionRef.limit(batchSize).get();
  if (snap.empty) return 0;
  let count = 0;
  const batch = db.batch();
  snap.docs.forEach(d => { batch.delete(d.ref); count++; });
  await batch.commit();
  if (snap.size === batchSize) count += await deleteCollection(db, collectionRef, batchSize);
  return count;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  const { uid } = req.body || {};
  if (!uid || typeof uid !== "string") return res.status(400).json({ error: "Missing uid" });
  // Prevent the admin from accidentally nuking their own account.
  if (decoded.uid === uid) return res.status(400).json({ error: "Cannot delete your own admin account" });

  try {
    const db = admin.firestore();
    const summary = { recruiterDocDeleted: false, publicProcessesDeleted: 0, applicationsDeleted: 0, authUserDeleted: false };

    // 1. Delete all publicProcesses owned by this recruiter, including their applications subcollections.
    const pubSnap = await db.collection("publicProcesses").where("recruiterUid", "==", uid).get();
    for (const doc of pubSnap.docs) {
      const appsDeleted = await deleteCollection(db, doc.ref.collection("applications"));
      summary.applicationsDeleted += appsDeleted;
      await doc.ref.delete();
      summary.publicProcessesDeleted++;
    }

    // 2. Delete the recruiter doc itself (and legacy users/{uid} if present).
    const recRef = db.collection("recruiters").doc(uid);
    if ((await recRef.get()).exists) { await recRef.delete(); summary.recruiterDocDeleted = true; }
    try { await db.collection("users").doc(uid).delete(); } catch { /* may not exist */ }

    // 3. Delete Firebase Auth user so they can't log back in.
    try { await admin.auth().deleteUser(uid); summary.authUserDeleted = true; }
    catch (e) {
      // Auth user may not exist if they were Firestore-only. Not fatal.
      console.warn("Auth user delete:", e.message);
    }

    return res.status(200).json({ success: true, summary });
  } catch (err) {
    console.error("admin/deleteUser error:", err);
    return res.status(500).json({ error: err.message });
  }
}
