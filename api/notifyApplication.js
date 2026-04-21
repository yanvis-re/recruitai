// api/notifyApplication.js
//
// Server-side endpoint for sending the "new application" Slack notification
// when a candidate submits an application through the public link.
//
// The Slack webhook URL is intentionally NOT stored in the public process doc
// (it's a secret — anyone with the candidate link could read and abuse it).
// Instead, this endpoint uses Firebase Admin SDK to look up the webhook from
// the recruiter's private doc at recruiters/{recruiterUid}.
//
// Required Vercel env var:
//   FIREBASE_SERVICE_ACCOUNT_KEY — JSON of the Firebase service account key.
//   Get it from Firebase Console → Settings → Service accounts → Generate new private key.

import admin from "firebase-admin";

// Initialize admin SDK exactly once per container.
if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(raw)),
      });
    } catch (e) {
      console.error("Failed to initialize firebase-admin:", e.message);
    }
  } else {
    console.warn("FIREBASE_SERVICE_ACCOUNT_KEY not set — notifyApplication will no-op.");
  }
}

// Mirror of the frontend POSITIONS labels, used to build a readable position title.
const POSITION_LABELS = {
  media_buyer: "Media Buyer",
  copywriter: "Copywriter",
  automatizador: "Automatizador",
  estratega: "Estratega / Funnel Builder",
  asistente_virtual: "Asistente Virtual",
  project_manager: "Project Manager",
  estratega_creativo: "Estratega Creativo",
  creativo_editor: "Creativo / Editor",
  redes_sociales: "Social Media Manager",
};

function getPositionTitle(position) {
  if (!position) return "Posición";
  if (position.positionType === "otro") return position.customTitle || "Otro";
  const base = POSITION_LABELS[position.positionType] || position.positionType || "Posición";
  return position.specialty ? `${base} — ${position.specialty}` : base;
}

function buildNewApplicationMessage({ candidateName, candidateEmail, positionTitle, companyName }) {
  return {
    blocks: [
      { type: "header", text: { type: "plain_text", text: "🔔 Nueva solicitud recibida", emoji: true } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Candidato:*\n${candidateName}` },
          { type: "mrkdwn", text: `*Puesto:*\n${positionTitle}` },
          { type: "mrkdwn", text: `*Email:*\n${candidateEmail}` },
          { type: "mrkdwn", text: `*Empresa:*\n${companyName}` },
        ],
      },
      { type: "divider" },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `RecruitAI · ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` }],
      },
    ],
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!admin.apps.length) {
    // No-op gracefully: candidates still get their confirmation, recruiter just won't get a ping
    return res.status(200).json({ success: false, skipped: true, reason: "admin_sdk_not_initialized" });
  }

  const { processId, candidateName, candidateEmail } = req.body || {};
  if (!processId) return res.status(400).json({ error: "Missing processId" });

  try {
    const db = admin.firestore();

    // 1) Read the public process to find the recruiter
    const procSnap = await db.collection("publicProcesses").doc(processId).get();
    if (!procSnap.exists) return res.status(404).json({ error: "Process not found" });

    const procData = procSnap.data();
    const recruiterUid = procData.recruiterUid;
    if (!recruiterUid) {
      // Process published before recruiterUid field was introduced — regenerate the link to fix.
      return res.status(200).json({ success: true, skipped: true, reason: "legacy_no_recruiter_uid" });
    }

    // 2) Read the private recruiter doc to get the webhook
    const recSnap = await db.collection("recruiters").doc(recruiterUid).get();
    if (!recSnap.exists) return res.status(200).json({ success: true, skipped: true, reason: "no_recruiter_doc" });

    const slackConfig = recSnap.data()?.settings?.slackConfig;
    if (!slackConfig?.webhookUrl) {
      return res.status(200).json({ success: true, skipped: true, reason: "no_webhook_configured" });
    }

    // 3) Respect user preference (default to notify if unset)
    const notif = slackConfig.notifications?.newApplication;
    const shouldNotify = notif === undefined || notif === "instant" || notif === "both";
    if (!shouldNotify) {
      return res.status(200).json({ success: true, skipped: true, reason: "preference_off" });
    }

    // 4) Build and send the Slack message
    const message = buildNewApplicationMessage({
      candidateName: candidateName || "Candidato",
      candidateEmail: candidateEmail || "",
      positionTitle: getPositionTitle(procData.position),
      companyName: procData.company?.name || "La empresa",
    });

    const response = await fetch(slackConfig.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Slack webhook rejected:", text);
      return res.status(500).json({ error: `Slack error: ${text}` });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("notifyApplication error:", err);
    return res.status(500).json({ error: err.message });
  }
}
