// api/validateInviteCode.js
//
// PUBLIC endpoint (no auth) that checks whether an invite code is valid WITHOUT
// consuming it. Used by the signup form to give the recruiter instant feedback
// before they submit. Actual consumption happens in /api/consumeInviteCode
// after the account is created.
//
// Body: { code }
// Returns: { valid: true, meta } or { valid: false, reason }

import admin from "firebase-admin";

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) { try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); } catch (e) { console.error("firebase-admin init:", e.message); } }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!admin.apps.length) return res.status(200).json({ valid: false, reason: "service_unavailable" });

  const raw = (req.body?.code || "").toString().trim().toUpperCase();
  if (!raw) return res.status(200).json({ valid: false, reason: "empty" });

  try {
    const db = admin.firestore();
    const snap = await db.collection("inviteCodes").doc(raw).get();
    if (!snap.exists) return res.status(200).json({ valid: false, reason: "not_found" });

    const data = snap.data();
    if (data.enabled === false) return res.status(200).json({ valid: false, reason: "disabled" });

    if (data.expiresAt) {
      const exp = new Date(data.expiresAt).getTime();
      if (exp < Date.now()) return res.status(200).json({ valid: false, reason: "expired" });
    }

    const uses = data.uses || 0;
    const max = data.maxUses ?? -1;
    if (max > 0 && uses >= max) return res.status(200).json({ valid: false, reason: "exhausted" });

    return res.status(200).json({
      valid: true,
      meta: { code: raw, note: data.note || "", remaining: max > 0 ? Math.max(0, max - uses) : null },
    });
  } catch (err) {
    console.error("validateInviteCode error:", err);
    return res.status(500).json({ valid: false, reason: "server_error" });
  }
}
