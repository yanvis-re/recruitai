// api/admin/updateUserStatus.js
//
// Admin-only endpoint that flips a recruiter's status between pending / active
// / suspended and optionally fires the 'account_activated' email when the
// transition is to 'active'.
//
// Body: { uid, status, note? }
// Auth: same as listUsers — Bearer ID token, must decode to ADMIN_EMAIL.

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

async function requireAdmin(req, res) {
  if (!admin.apps.length) { res.status(500).json({ error: "admin_sdk_not_initialized" }); return null; }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Missing token" }); return null; }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if ((decoded.email || "").toLowerCase().trim() !== ADMIN_EMAIL.toLowerCase().trim()) { res.status(403).json({ error: "Forbidden" }); return null; }
    return decoded;
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  const { uid, status, note } = req.body || {};
  if (!uid || typeof uid !== "string") return res.status(400).json({ error: "Missing uid" });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });

  try {
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

    // Fire activation email when transitioning from pending/suspended → active.
    let emailSent = false;
    if (wasNotActive && goingToActive) {
      const apiKey = process.env.RESEND_API_KEY;
      const fromEmail = process.env.FROM_EMAIL || "onboarding@resend.dev";
      const recipient = prev.email || "";
      if (apiKey && recipient) {
        try {
          const t = templateAccountActivated(prev.displayName || "");
          const resend = new Resend(apiKey);
          await resend.emails.send({
            from: `RecruitAI <${fromEmail}>`,
            to: recipient,
            subject: t.subject,
            html: t.html,
          });
          emailSent = true;
        } catch (e) { console.error("Activation email failed:", e.message); }
      }
    }

    return res.status(200).json({ success: true, previousStatus: prev.status || "active", newStatus: status, emailSent });
  } catch (err) {
    console.error("admin/updateUserStatus error:", err);
    return res.status(500).json({ error: err.message });
  }
}
