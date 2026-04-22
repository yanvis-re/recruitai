// api/notify.js
//
// Consolidated notifications router. Four actions, all Slack-backed:
//
//   action: "application" { processId, candidateName, candidateEmail }
//     Server-side Slack alert on new candidate application. Reads the Slack
//     webhook from the recruiter's PRIVATE doc via firebase-admin — the
//     webhook is never exposed in publicProcesses/{id}.
//
//   action: "signup" { email, displayName, uid, provider }
//     "New user registered" alert to the owner's FEEDBACK_SLACK_WEBHOOK.
//
//   action: "slack" { type, data, webhookUrl }
//     Client-side trigger (recruiter's own webhook) for in-app events:
//     new_application | ai_evaluation | final_decision | daily_digest.
//     Message builders live here and are formatted with Slack block kit.
//
//   action: "feedback" { type, message, url, userAgent, userEmail, userName, viewport }
//     In-app feedback widget → owner's FEEDBACK_SLACK_WEBHOOK.
//
// Collapsed from 4 separate endpoints to stay under the Vercel Hobby
// serverless-function limit.
//
// Required Vercel env vars:
//   FIREBASE_SERVICE_ACCOUNT_KEY  (for action: "application")
//   FEEDBACK_SLACK_WEBHOOK        (for actions: "signup", "feedback")

import admin from "firebase-admin";

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) { try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); } catch (e) { console.error("firebase-admin init:", e.message); } }
}

// Readable labels for position types (mirrors frontend POSITIONS)
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

function getProcessTitle(p) {
  if (p.position?.positionType === "otro") return p.position?.customTitle || "Personalizado";
  const base = POSITION_LABELS[p.position?.positionType] || p.position?.positionType || "Posición";
  return p.position?.specialty ? `${base} · ${p.position.specialty}` : base;
}

async function postToSlack(webhookUrl, message) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack error: ${text}`);
  }
}

// ── Message builders (shared across actions) ────────────────────────────────

function buildNewApplicationMessage({ candidateName, candidateEmail, positionTitle, companyName, dashboardUrl }) {
  const blocks = [
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
  ];
  if (dashboardUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "📋 Ver candidatura en RecruitAI", emoji: true },
          url: dashboardUrl,
          style: "primary",
        },
      ],
    });
  }
  blocks.push({ type: "divider" });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `RecruitAI · ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` }] });
  return { blocks };
}

function buildAiEvaluationMessage({ candidateName, positionTitle, evaluationType, recommendation, score, dashboardUrl }) {
  const evalLabel = evaluationType === "exercise" ? "Ejercicio" : "Entrevista";
  const recColors = { AVANZAR: "✅", REVISAR: "⚠️", DESCARTAR: "❌", CONTRATAR: "🎉" };
  const recIcon = recColors[recommendation] || "📊";
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `🤖 Evaluación IA completada · ${evalLabel}`, emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Candidato:*\n${candidateName}` },
        { type: "mrkdwn", text: `*Puesto:*\n${positionTitle}` },
        { type: "mrkdwn", text: `*Tipo:*\n${evalLabel}` },
        { type: "mrkdwn", text: `*Resultado IA:*\n${recIcon} ${recommendation || "—"}${score ? ` (${score}/100)` : ""}` },
      ],
    },
  ];
  if (dashboardUrl) {
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "📋 Abrir evaluación en RecruitAI", emoji: true },
        url: dashboardUrl,
        style: "primary",
      }],
    });
  }
  blocks.push({ type: "divider" });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `RecruitAI · ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` }] });
  return { blocks };
}

function buildFinalDecisionMessage({ candidateName, positionTitle, decision, dashboardUrl }) {
  const icons = { Contratado: "🎉", "Segunda entrevista": "🔄", "En cartera": "📁", Descartado: "❌" };
  const icon = icons[decision] || "✅";
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `${icon} Decisión final tomada`, emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Candidato:*\n${candidateName}` },
        { type: "mrkdwn", text: `*Puesto:*\n${positionTitle}` },
        { type: "mrkdwn", text: `*Decisión:*\n${icon} ${decision}` },
      ],
    },
  ];
  if (dashboardUrl) {
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "📋 Abrir candidatura en RecruitAI", emoji: true },
        url: dashboardUrl,
        style: "primary",
      }],
    });
  }
  blocks.push({ type: "divider" });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `RecruitAI · ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` }] });
  return { blocks };
}

function buildDailyDigestMessage({ processes, date }) {
  const active = processes.filter(p => p.status === "active");
  if (active.length === 0) return null;

  const totalCandidates = active.reduce((s, p) => s + (p.candidates?.length || 0), 0);
  const newToday = active.reduce((s, p) => s + (p.candidates?.filter(c => {
    if (!c.submittedAt) return false;
    return new Date(c.submittedAt).toDateString() === new Date().toDateString();
  }).length || 0), 0);

  const processBlocks = active.flatMap(p => {
    const title = getProcessTitle(p);
    const company = p.company?.name ? ` · ${p.company.name}` : "";
    const cs = p.candidates || [];
    const total = cs.length;
    const pending   = cs.filter(c => c.estado === "Pendiente").length;
    const interview = cs.filter(c => c.estado === "Primera entrevista" || c.estado === "Segunda entrevista").length;
    const hired     = cs.filter(c => c.estado === "Contratado").length;
    const portfolio = cs.filter(c => c.estado === "En cartera").length;
    const discarded = cs.filter(c => c.estado === "Descartado").length;

    const tags = [
      pending   > 0 ? `⏳ ${pending} pendiente${pending > 1 ? "s" : ""}` : null,
      interview > 0 ? `🎤 ${interview} en entrevista` : null,
      hired     > 0 ? `🎉 ${hired} contratado${hired > 1 ? "s" : ""}` : null,
      portfolio > 0 ? `📁 ${portfolio} en cartera` : null,
      discarded > 0 ? `❌ ${discarded} descartado${discarded > 1 ? "s" : ""}` : null,
    ].filter(Boolean);

    const summary = total === 0
      ? "Sin candidatos aún"
      : `${total} candidato${total !== 1 ? "s" : ""} — ${tags.length > 0 ? tags.join("  ·  ") : "sin etapa asignada"}`;

    return [{ type: "section", text: { type: "mrkdwn", text: `*${title}*${company}\n${summary}` } }];
  });

  return {
    blocks: [
      { type: "header", text: { type: "plain_text", text: `📊 Resumen diario · ${date}`, emoji: true } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Procesos activos:*\n${active.length}` },
          { type: "mrkdwn", text: `*Total en pipeline:*\n${totalCandidates}` },
          { type: "mrkdwn", text: `*Nuevas solicitudes hoy:*\n${newToday > 0 ? `🆕 ${newToday}` : "Ninguna"}` },
        ],
      },
      { type: "divider" },
      ...processBlocks,
      { type: "divider" },
      { type: "context", elements: [{ type: "mrkdwn", text: `RecruitAI · Resumen automático diario` }] },
    ],
  };
}

// ── Action handlers ──────────────────────────────────────────────────────────

async function application(req, res) {
  if (!admin.apps.length) {
    return res.status(200).json({ success: false, skipped: true, reason: "admin_sdk_not_initialized" });
  }
  const { processId, applicationId, candidateName, candidateEmail } = req.body || {};
  if (!processId) return res.status(400).json({ error: "Missing processId" });

  const db = admin.firestore();
  const procSnap = await db.collection("publicProcesses").doc(processId).get();
  if (!procSnap.exists) return res.status(404).json({ error: "Process not found" });

  const procData = procSnap.data();
  const recruiterUid = procData.recruiterUid;
  if (!recruiterUid) return res.status(200).json({ success: true, skipped: true, reason: "legacy_no_recruiter_uid" });

  const recSnap = await db.collection("recruiters").doc(recruiterUid).get();
  if (!recSnap.exists) return res.status(200).json({ success: true, skipped: true, reason: "no_recruiter_doc" });

  const slackConfig = recSnap.data()?.settings?.slackConfig;
  if (!slackConfig?.webhookUrl) return res.status(200).json({ success: true, skipped: true, reason: "no_webhook_configured" });

  const notif = slackConfig.notifications?.newApplication;
  const shouldNotify = notif === undefined || notif === "instant" || notif === "both";
  if (!shouldNotify) return res.status(200).json({ success: true, skipped: true, reason: "preference_off" });

  // Build a deep link into the dashboard. The APP_URL env var is the
  // production base URL; if missing we fall back to a best-guess from the
  // process doc. The candidate query param is optional — the dashboard
  // consumes it to auto-open the evaluation panel for that application.
  const appUrl = process.env.APP_URL || "https://recruitai-smoky.vercel.app";
  const candidateParam = applicationId ? `?candidate=app_${applicationId}` : "";
  const dashboardUrl = `${appUrl}/#process/${processId}${candidateParam}`;

  const message = buildNewApplicationMessage({
    candidateName: candidateName || "Candidato",
    candidateEmail: candidateEmail || "",
    positionTitle: getPositionTitle(procData.position),
    companyName: procData.company?.name || "La empresa",
    dashboardUrl,
  });
  await postToSlack(slackConfig.webhookUrl, message);
  return res.status(200).json({ success: true });
}

async function signup(req, res) {
  const webhookUrl = process.env.FEEDBACK_SLACK_WEBHOOK;
  if (!webhookUrl) {
    console.warn("FEEDBACK_SLACK_WEBHOOK not configured — signup notification dropped");
    return res.status(200).json({ success: false, skipped: true });
  }

  const { email, displayName, uid, provider } = req.body || {};
  if (!email && !uid) return res.status(400).json({ error: "Missing email/uid" });

  const message = {
    blocks: [
      { type: "header", text: { type: "plain_text", text: "🆕 Nuevo registro en RecruitAI", emoji: true } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Nombre:*\n${displayName || "(sin nombre)"}` },
          { type: "mrkdwn", text: `*Email:*\n${email || "—"}` },
          { type: "mrkdwn", text: `*Proveedor:*\n${provider || "—"}` },
          { type: "mrkdwn", text: `*UID:*\n\`${uid || "—"}\`` },
        ],
      },
      { type: "section", text: { type: "mrkdwn", text: "⏳ *Estado:* pendiente de aprobación en el Panel Admin." } },
      { type: "divider" },
      { type: "context", elements: [{ type: "mrkdwn", text: `RecruitAI · ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` }] },
    ],
  };
  await postToSlack(webhookUrl, message);
  return res.status(200).json({ success: true });
}

async function slack(req, res) {
  const { type, data, webhookUrl } = req.body || {};
  if (!webhookUrl) return res.status(400).json({ error: "No webhookUrl provided" });

  const BUILDERS = {
    new_application: buildNewApplicationMessage,
    ai_evaluation: buildAiEvaluationMessage,
    final_decision: buildFinalDecisionMessage,
    daily_digest: buildDailyDigestMessage,
  };
  const builder = BUILDERS[type];
  if (!builder) return res.status(400).json({ error: `Unknown slack type: ${type}` });

  const message = builder(data);
  if (!message) return res.status(200).json({ success: true, skipped: true }); // e.g. empty daily digest
  await postToSlack(webhookUrl, message);
  return res.status(200).json({ success: true });
}

const TYPE_CONFIG = {
  bug:      { icon: "🐛", label: "Bug reportado" },
  idea:     { icon: "💡", label: "Idea / Mejora" },
  confused: { icon: "😕", label: "Algo confuso" },
  love:     { icon: "❤️", label: "Feedback positivo" },
};

function buildFeedbackMessage({ type, message, url, userAgent, userEmail, userName, viewport }) {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.idea;
  return {
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${cfg.icon} ${cfg.label}`, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: `>${message.trim().replace(/\n/g, "\n>")}` } },
      { type: "divider" },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*De:*\n${userName || "Sin nombre"}` },
          { type: "mrkdwn", text: `*Email:*\n${userEmail || "—"}` },
          { type: "mrkdwn", text: `*URL:*\n\`${url || "—"}\`` },
          { type: "mrkdwn", text: `*Viewport:*\n${viewport || "—"}` },
        ],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `_${(userAgent || "").slice(0, 200)}_ · ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` }],
      },
    ],
  };
}

async function feedback(req, res) {
  const webhookUrl = process.env.FEEDBACK_SLACK_WEBHOOK;
  if (!webhookUrl) {
    console.warn("FEEDBACK_SLACK_WEBHOOK not configured — feedback dropped");
    return res.status(200).json({ success: false, skipped: true, reason: "webhook_not_configured" });
  }

  const { type, message } = req.body || {};
  if (!message || typeof message !== "string" || message.trim().length < 3) {
    return res.status(400).json({ error: "Añade al menos 3 caracteres de descripción." });
  }
  if (!["bug", "idea", "confused", "love"].includes(type)) {
    return res.status(400).json({ error: "Tipo de feedback inválido." });
  }
  if (message.length > 2500) {
    return res.status(400).json({ error: "Mensaje demasiado largo (máx. 2500 caracteres)." });
  }

  const slackMessage = buildFeedbackMessage(req.body);
  await postToSlack(webhookUrl, slackMessage);
  return res.status(200).json({ success: true });
}

// ── Router ───────────────────────────────────────────────────────────────────

const ACTIONS = { application, signup, slack, feedback };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const action = req.body?.action || "";
  const fn = ACTIONS[action];
  if (!fn) return res.status(400).json({ error: `Unknown action: ${action}. Use "application" | "signup" | "slack" | "feedback".` });

  try {
    return await fn(req, res);
  } catch (err) {
    console.error(`notify/${action} error:`, err);
    return res.status(500).json({ error: err.message });
  }
}
