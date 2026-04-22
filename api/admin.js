// api/admin.js
//
// Consolidated admin router. All admin-only operations go through this
// single endpoint with an `action` field in the body. Collapsed from the
// original api/admin/*.js (7 files) because the Hobby plan on Vercel caps
// serverless functions at 12 per project.
//
// Auth: every action requires 'Authorization: Bearer {firebase ID token}'
// and the decoded email MUST match ADMIN_EMAIL (case-insensitive).
//
// Body shape: { action, ...args }
// Supported actions:
//   list_users                            → GET-like list of recruiters
//   update_status   { uid, status, note } → pending|active|suspended transitions
//   delete_user     { uid }               → hard-delete recruiter + processes
//   list_codes                            → list invite codes
//   create_code     { code?, maxUses, expiresAt, note }
//   update_code     { code, enabled?, maxUses?, expiresAt?, note? }
//   delete_code     { code }
//
// Required Vercel env vars:
//   FIREBASE_SERVICE_ACCOUNT_KEY
//   ADMIN_EMAIL   (defaults to 'yanvis@gmail.com')
//   RESEND_API_KEY  (optional, only for the account-activated email)
//   FROM_EMAIL      (optional, defaults to 'onboarding@resend.dev')
//   APP_URL         (optional, defaults to the live deploy URL)

import admin from "firebase-admin";
import { Resend } from "resend";

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); }
    catch (e) { console.error("firebase-admin init error:", e.message); }
  }
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "yanvis@gmail.com";
const APP_URL = process.env.APP_URL || "https://recruitai-smoky.vercel.app";
const VALID_STATUSES = ["pending", "active", "suspended"];
const SAFE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

async function requireAdmin(req, res) {
  if (!admin.apps.length) { res.status(500).json({ error: "admin_sdk_not_initialized" }); return null; }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Missing token" }); return null; }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if ((decoded.email || "").toLowerCase().trim() !== ADMIN_EMAIL.toLowerCase().trim()) {
      res.status(403).json({ error: "Forbidden" }); return null;
    }
    return decoded;
  } catch {
    res.status(401).json({ error: "Invalid token" }); return null;
  }
}

// ── Users ────────────────────────────────────────────────────────────────────

async function listUsers(req, res) {
  const db = admin.firestore();
  const [recSnap, agencySnap] = await Promise.all([
    db.collection("recruiters").get(),
    db.collection("agencies").get(),
  ]);

  // Build an agency lookup once. Each user hits this map in O(1) instead of
  // fetching N individual agency docs. Works well up to a few thousand
  // agencies, which is way past our beta-tier scale.
  const agencyById = {};
  agencySnap.forEach(d => { agencyById[d.id] = d.data(); });

  const users = await Promise.all(recSnap.docs.map(async (d) => {
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

    // Agency metadata: with multi-tenancy, processes and candidates live on
    // the agency, not the recruiter. Pre-migration docs still have those
    // fields locally; we fall back to them so counts stay accurate during
    // the transition.
    const agencyId = data.agencyId || null;
    const agency = agencyId ? agencyById[agencyId] : null;
    const processes = agency?.processes || data.processes || [];
    const myRole =
      agency?.ownerUid === d.id ? "owner"
      : (agency?.members || []).find(m => m.uid === d.id)?.role
      || (agency ? "member" : null);

    return {
      uid: d.id,
      email: authEmail,
      displayName: authName,
      status: data.status || "active", // legacy docs without status = active
      statusUpdatedAt: data.statusUpdatedAt || null,
      statusNote: data.statusNote || "",
      createdAt: data.createdAt || null,
      lastSignInTime,
      agencyId,
      agencyName: agency?.name || "",
      role: myRole,
      processCount: processes.length,
      candidateCount: processes.reduce((s, p) => s + (p.candidates?.length || 0), 0),
    };
  }));

  users.sort((a, b) => {
    const aT = new Date(a.createdAt || a.lastSignInTime || 0).getTime();
    const bT = new Date(b.createdAt || b.lastSignInTime || 0).getTime();
    return bT - aT;
  });
  return res.status(200).json({ users, adminEmail: ADMIN_EMAIL });
}

function templateAccountActivated(userName) {
  const firstName = (userName || "").trim().split(" ")[0] || "hola";
  return {
    subject: "🎉 Tu cuenta de RecruitAI está activa",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
      <div style="background:#111827;padding:32px;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:24px;letter-spacing:-0.02em">🎉 ¡Ya puedes entrar, ${firstName}!</h1></div>
      <div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
        <p style="font-size:16px">Tu cuenta de <strong>RecruitAI</strong> acaba de activarse. Ya tienes acceso completo al dashboard.</p>
        <p style="font-size:15px;line-height:1.6">Te acompaño con una hoja de ruta desde que entras hasta que tienes tu primer proceso publicado. Son unos 10 minutos.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${APP_URL}" style="display:inline-block;background:#111827;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px">🚀 Abrir RecruitAI</a>
        </div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
        <p style="font-size:13px;color:#6b7280;line-height:1.5">¿Dudas? Responde a este email y te ayudo.</p>
        <div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb">
          <p style="font-size:11px;color:#9ca3af;margin:0 0 6px 0">RecruitAI por</p>
          <a href="https://rumboeficiente.com" style="text-decoration:none"><img src="${APP_URL}/rumbo-on-light.png" alt="Rumbo Eficiente" style="height:22px;max-width:220px" /></a>
        </div>
      </div></div>`,
  };
}

async function updateStatus(req, res) {
  const { uid, status, note } = req.body || {};
  if (!uid || typeof uid !== "string") return res.status(400).json({ error: "Missing uid" });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });

  const db = admin.firestore();
  const ref = db.collection("recruiters").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: "User not found" });

  const prev = snap.data();
  const wasNotActive = (prev.status || "active") !== "active";
  const goingToActive = status === "active";

  await ref.set({
    status,
    statusUpdatedAt: new Date().toISOString(),
    statusNote: note || prev.statusNote || "",
  }, { merge: true });

  // Fire activation email on pending/suspended → active.
  let emailSent = false;
  if (wasNotActive && goingToActive) {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.FROM_EMAIL || "onboarding@resend.dev";
    const recipient = prev.email || "";
    if (apiKey && recipient) {
      try {
        const t = templateAccountActivated(prev.displayName || "");
        const resend = new Resend(apiKey);
        await resend.emails.send({ from: `RecruitAI <${fromEmail}>`, to: recipient, subject: t.subject, html: t.html });
        emailSent = true;
      } catch (e) { console.error("Activation email failed:", e.message); }
    }
  }

  return res.status(200).json({ success: true, previousStatus: prev.status || "active", newStatus: status, emailSent });
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

async function deleteUser(req, res, decoded) {
  const { uid } = req.body || {};
  if (!uid || typeof uid !== "string") return res.status(400).json({ error: "Missing uid" });
  if (decoded.uid === uid) return res.status(400).json({ error: "Cannot delete your own admin account" });

  const db = admin.firestore();
  const summary = { recruiterDocDeleted: false, publicProcessesDeleted: 0, applicationsDeleted: 0, authUserDeleted: false };

  const pubSnap = await db.collection("publicProcesses").where("recruiterUid", "==", uid).get();
  for (const doc of pubSnap.docs) {
    const appsDeleted = await deleteCollection(db, doc.ref.collection("applications"));
    summary.applicationsDeleted += appsDeleted;
    await doc.ref.delete();
    summary.publicProcessesDeleted++;
  }

  const recRef = db.collection("recruiters").doc(uid);
  if ((await recRef.get()).exists) { await recRef.delete(); summary.recruiterDocDeleted = true; }
  try { await db.collection("users").doc(uid).delete(); } catch { /* may not exist */ }

  try { await admin.auth().deleteUser(uid); summary.authUserDeleted = true; }
  catch (e) { console.warn("Auth user delete:", e.message); }

  return res.status(200).json({ success: true, summary });
}

// ── Invite Codes ─────────────────────────────────────────────────────────────

async function listCodes(req, res) {
  const db = admin.firestore();
  const snap = await db.collection("inviteCodes").get();
  const codes = snap.docs.map(d => ({ code: d.id, ...d.data() }));
  codes.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  return res.status(200).json({ codes });
}

function generateCode() {
  let chunk = "";
  for (let i = 0; i < 6; i++) chunk += SAFE_ALPHABET[Math.floor(Math.random() * SAFE_ALPHABET.length)];
  return `RAI-${chunk}`;
}

async function createCode(req, res, decoded) {
  const { code: providedCode, maxUses, expiresAt, note } = req.body || {};
  const db = admin.firestore();

  let code;
  if (providedCode) {
    code = String(providedCode).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!code || code.length < 3) return res.status(400).json({ error: "Custom code must be at least 3 alphanumeric characters." });
    const existing = await db.collection("inviteCodes").doc(code).get();
    if (existing.exists) return res.status(409).json({ error: "Code already exists" });
  } else {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCode();
      const ex = await db.collection("inviteCodes").doc(candidate).get();
      if (!ex.exists) { code = candidate; break; }
    }
    if (!code) return res.status(500).json({ error: "Failed to generate a unique code" });
  }

  const payload = {
    code,
    createdAt: new Date().toISOString(),
    createdBy: decoded.uid,
    createdByEmail: decoded.email,
    enabled: true,
    uses: 0,
    maxUses: typeof maxUses === "number" && maxUses > 0 ? maxUses : null,
    expiresAt: expiresAt || null,
    note: note || "",
    lastUsedAt: null,
  };

  await db.collection("inviteCodes").doc(code).set(payload);
  return res.status(200).json({ success: true, code: payload });
}

async function updateCode(req, res) {
  const { code: rawCode, enabled, maxUses, expiresAt, note } = req.body || {};
  const code = (rawCode || "").toString().trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Missing code" });

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
}

async function deleteCode(req, res) {
  const code = (req.body?.code || "").toString().trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Missing code" });
  const db = admin.firestore();
  await db.collection("inviteCodes").doc(code).delete();
  return res.status(200).json({ success: true });
}

// ── Router ───────────────────────────────────────────────────────────────────

const ACTIONS = {
  list_users: listUsers,
  update_status: updateStatus,
  delete_user: deleteUser,
  list_codes: listCodes,
  create_code: createCode,
  update_code: updateCode,
  delete_code: deleteCode,
};

export default async function handler(req, res) {
  // Allow both GET (legacy list_users compat) and POST. The body.action field
  // is the real dispatcher — all mutations and reads use POST with a JSON body.
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  // GET requests default to list_users to keep list_users reachable via GET
  // (some clients prefer that semantically).
  const action = req.method === "GET" ? "list_users" : (req.body?.action || "");
  const fn = ACTIONS[action];
  if (!fn) return res.status(400).json({ error: `Unknown or missing action: ${action}` });

  try {
    return await fn(req, res, decoded);
  } catch (err) {
    console.error(`admin/${action} error:`, err);
    return res.status(500).json({ error: err.message });
  }
}
