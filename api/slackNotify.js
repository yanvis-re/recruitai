// ── Slack message builders ───────────────────────────────────────────────────

function buildNewApplicationMessage({ candidateName, candidateEmail, positionTitle, companyName, processId }) {
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🔔 Nueva solicitud recibida", emoji: true },
      },
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

function buildAiEvaluationMessage({ candidateName, positionTitle, evaluationType, recommendation, score }) {
  const evalLabel = evaluationType === "exercise" ? "Ejercicio" : "Entrevista";
  const recColors = { AVANZAR: "✅", REVISAR: "⚠️", DESCARTAR: "❌", CONTRATAR: "🎉" };
  const recIcon = recColors[recommendation] || "📊";
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `🤖 Evaluación IA completada · ${evalLabel}`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Candidato:*\n${candidateName}` },
          { type: "mrkdwn", text: `*Puesto:*\n${positionTitle}` },
          { type: "mrkdwn", text: `*Tipo:*\n${evalLabel}` },
          { type: "mrkdwn", text: `*Resultado IA:*\n${recIcon} ${recommendation || "—"}${score ? ` (${score}/100)` : ""}` },
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

function buildFinalDecisionMessage({ candidateName, positionTitle, decision }) {
  const icons = { Contratado: "🎉", "Segunda entrevista": "🔄", "En cartera": "📁", Descartado: "❌" };
  const icon = icons[decision] || "✅";
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${icon} Decisión final tomada`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Candidato:*\n${candidateName}` },
          { type: "mrkdwn", text: `*Puesto:*\n${positionTitle}` },
          { type: "mrkdwn", text: `*Decisión:*\n${icon} ${decision}` },
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

// Readable labels for position types (mirrors frontend POSITIONS array)
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

function getProcessTitle(p) {
  if (p.position?.positionType === "otro") return p.position?.customTitle || "Personalizado";
  const base = POSITION_LABELS[p.position?.positionType] || p.position?.positionType || "Posición";
  return p.position?.specialty ? `${base} · ${p.position.specialty}` : base;
}

function buildDailyDigestMessage({ processes, date }) {
  const active = processes.filter(p => p.status === "active");
  if (active.length === 0) return null;

  // Global totals
  const totalCandidates = active.reduce((s, p) => s + (p.candidates?.length || 0), 0);
  const newToday = active.reduce((s, p) => s + (p.candidates?.filter(c => {
    if (!c.submittedAt) return false;
    return new Date(c.submittedAt).toDateString() === new Date().toDateString();
  }).length || 0), 0);

  // One section block per active process
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

    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${title}*${company}\n${summary}` },
      },
    ];
  });

  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `📊 Resumen diario · ${date}`, emoji: true },
      },
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
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `RecruitAI · Resumen automático diario` }],
      },
    ],
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, data, webhookUrl } = req.body;

  if (!webhookUrl) return res.status(400).json({ error: "No webhookUrl provided" });

  const BUILDERS = {
    new_application: buildNewApplicationMessage,
    ai_evaluation: buildAiEvaluationMessage,
    final_decision: buildFinalDecisionMessage,
    daily_digest: buildDailyDigestMessage,
  };

  const builder = BUILDERS[type];
  if (!builder) return res.status(400).json({ error: `Unknown type: ${type}` });

  const message = builder(data);
  if (!message) return res.status(200).json({ success: true, skipped: true }); // e.g. no active processes

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: `Slack error: ${text}` });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("slackNotify error:", err);
    return res.status(500).json({ error: err.message });
  }
}
