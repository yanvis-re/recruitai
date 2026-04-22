// api/consumeInviteCode.js
//
// Authenticated endpoint that atomically:
//   1. re-validates the invite code
//   2. increments its `uses` counter
//   3. flips the caller's recruiters/{uid} doc to status: 'active' + stamps
//      the code used (inviteCodeUsed field, for auditability)
//
// Called by the client right after the Firebase account is created.
// Authorization: Bearer {firebase ID token}.
//
// Idempotent: if the user is already active with a stamped inviteCodeUsed,
// a second call is a no-op (we don't re-increment).

import admin from "firebase-admin";

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) { try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); } catch (e) { console.error("firebase-admin init:", e.message); } }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!admin.apps.length) return res.status(500).json({ error: "service_unavailable" });

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  let decoded;
  try { decoded = await admin.auth().verifyIdToken(token); }
  catch { return res.status(401).json({ error: "Invalid token" }); }

  const code = (req.body?.code || "").toString().trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Missing code" });

  try {
    const db = admin.firestore();
    const recRef = db.collection("recruiters").doc(decoded.uid);
    const codeRef = db.collection("inviteCodes").doc(code);

    const result = await db.runTransaction(async (tx) => {
      const [recSnap, codeSnap] = await Promise.all([tx.get(recRef), tx.get(codeRef)]);
      if (!recSnap.exists) throw new Error("recruiter_doc_not_found");
      if (!codeSnap.exists) return { ok: false, reason: "not_found" };

      const code_data = codeSnap.data();
      if (code_data.enabled === false) return { ok: false, reason: "disabled" };
      if (code_data.expiresAt && new Date(code_data.expiresAt).getTime() < Date.now()) {
        return { ok: false, reason: "expired" };
      }
      const uses = code_data.uses || 0;
      const max = code_data.maxUses ?? -1;
      if (max > 0 && uses >= max) return { ok: false, reason: "exhausted" };

      // Idempotency: if this user has already consumed this same code, just
      // return success without re-incrementing.
      const rec = recSnap.data();
      if (rec.inviteCodeUsed === code && rec.status === "active") {
        return { ok: true, alreadyConsumed: true };
      }

      tx.update(codeRef, { uses: uses + 1, lastUsedAt: new Date().toISOString() });
      tx.set(recRef, {
        status: "active",
        statusUpdatedAt: new Date().toISOString(),
        inviteCodeUsed: code,
      }, { merge: true });
      return { ok: true, alreadyConsumed: false };
    });

    if (!result.ok) return res.status(200).json({ success: false, reason: result.reason });
    return res.status(200).json({ success: true, activated: true, alreadyConsumed: !!result.alreadyConsumed });
  } catch (err) {
    console.error("consumeInviteCode error:", err);
    return res.status(500).json({ error: err.message });
  }
}
