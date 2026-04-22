// api/inviteCode.js
//
// Consolidated invite-code router with two actions:
//
//   action: "validate" (no auth)
//     Checks whether a code exists, is enabled, not expired, not exhausted.
//     Used by the signup form for live feedback before submit.
//     Returns: { valid: true, meta } or { valid: false, reason }
//
//   action: "consume"  (requires Bearer ID token)
//     Atomically re-validates, increments uses, and flips the caller's
//     recruiters/{uid} doc to status: 'active' with inviteCodeUsed stamped.
//     Idempotent: a second call with the same user+code is a no-op.
//     Returns: { success: true, activated, alreadyConsumed } or { success: false, reason }
//
// Collapsed from validateInviteCode.js + consumeInviteCode.js to stay under
// the Vercel Hobby serverless-function limit.

import admin from "firebase-admin";

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) { try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); } catch (e) { console.error("firebase-admin init:", e.message); } }
}

async function validate(req, res) {
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
    console.error("inviteCode/validate error:", err);
    return res.status(500).json({ valid: false, reason: "server_error" });
  }
}

async function consume(req, res) {
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

      // Idempotency: already consumed by this user → return success without incrementing.
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
    console.error("inviteCode/consume error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// action: "acceptAgency" (requires Bearer ID token)
//
// Joins a user into the agency referenced by an agencyInvites/{token} doc.
// This MUST run server-side because the invitee is not yet a member of the
// target agency, and the agencies/{id} read/update rules require membership
// — a chicken-and-egg client-side can't solve. The admin SDK bypasses rules
// here, so we revalidate the invite ourselves (not expired, not used, agency
// exists) inside a Firestore transaction and then atomically:
//   - append {uid, email, displayName, role, joinedAt} to agency.members
//   - append uid to agency.memberUids
//   - stamp invite.{acceptedBy, acceptedAt, acceptedEmail}
//   - set recruiters/{uid}.{agencyId, status=active, statusUpdatedAt}
// Idempotent: if the user is already a member, we just mark the invite
// consumed without duplicating their membership entry.
async function acceptAgency(req, res) {
  if (!admin.apps.length) return res.status(500).json({ error: "service_unavailable" });

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  let decoded;
  try { decoded = await admin.auth().verifyIdToken(token); }
  catch { return res.status(401).json({ error: "Invalid token" }); }

  const inviteToken = (req.body?.inviteToken || "").toString().trim();
  if (!inviteToken) return res.status(400).json({ error: "Missing inviteToken" });

  try {
    const db = admin.firestore();
    const inviteRef = db.collection("agencyInvites").doc(inviteToken);

    const result = await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) return { ok: false, reason: "not_found" };
      const invite = inviteSnap.data();
      if (invite.acceptedBy) return { ok: false, reason: "already_used" };
      if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
        return { ok: false, reason: "expired" };
      }

      const agencyRef = db.collection("agencies").doc(invite.agencyId);
      const agencySnap = await tx.get(agencyRef);
      if (!agencySnap.exists) return { ok: false, reason: "agency_missing" };
      const agency = agencySnap.data();

      const now = new Date().toISOString();
      const alreadyMember = (agency.memberUids || []).includes(decoded.uid);

      if (!alreadyMember) {
        const newMember = {
          uid: decoded.uid,
          email: decoded.email || "",
          displayName: decoded.name || "",
          role: invite.role || "member",
          joinedAt: now,
        };
        tx.update(agencyRef, {
          members: [...(agency.members || []), newMember],
          memberUids: [...(agency.memberUids || []), decoded.uid],
        });
      }

      tx.update(inviteRef, {
        acceptedBy: decoded.uid,
        acceptedAt: now,
        acceptedEmail: decoded.email || "",
      });

      if (!alreadyMember) {
        tx.set(db.collection("recruiters").doc(decoded.uid), {
          agencyId: invite.agencyId,
          status: "active",
          statusUpdatedAt: now,
          // Marker so the client can show a one-time welcome screen to the
          // just-joined teammate. Cleared when they dismiss it.
          inviteeWelcomePending: true,
          inviteeWelcomeRole: invite.role || "member",
          inviteeWelcomeAgencyName: agency.name || "",
        }, { merge: true });
      }

      return { ok: true, agencyId: invite.agencyId, alreadyMember, agencyName: agency.name };
    });

    if (!result.ok) return res.status(200).json({ success: false, reason: result.reason });
    return res.status(200).json({ success: true, agencyId: result.agencyId, alreadyMember: result.alreadyMember, agencyName: result.agencyName });
  } catch (err) {
    console.error("inviteCode/acceptAgency error:", err);
    return res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const action = req.body?.action || "";
  if (action === "validate") return validate(req, res);
  if (action === "consume") return consume(req, res);
  if (action === "acceptAgency") return acceptAgency(req, res);
  return res.status(400).json({ error: `Unknown action: ${action}. Use "validate" | "consume" | "acceptAgency".` });
}
