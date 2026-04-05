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

function buildDailyDigestMessage({ processes, date }) {
  const active = processes.filter(p => p.status === "active");
  if (active.length === 0) return null; // Don't send if no active processes

  const totalCandidates = active.reduce((s, p) => s + (p.candidates?.length || 0), 0);
  const pending = active.reduce((s, p) => s + (p.candidates?.filter(c => c.estado === "Pendiente").length || 0), 0);
  const interviews = active.reduce((s, p) => s + (p.candidates?.filter(c => c.estado === "Primera entrevista" || c.estado === "Segunda entrevista").length || 0), 0);
  const hired = active.reduce((s, p) => s + (p.candidates?.filter(c => c.estado === "Contratado").length || 0), 0);
  const newToday = active.reduce((s, p) => s + (p.candidates?.filter(c => {
    if (!c.submittedAt) return false;
    const d = new Date(c.submittedAt);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length || 0), 0);

  const processLines = active.map(p => {
    const total = p.candidates?.length || 0;
    const pend = p.candidates?.filter(c => c.estado === "Pendiente").length || 0;
    return `• *${p.position?.title || p.positionType || "Posición"}* — ${total} candidatos${pend > 0 ? `, ${pend} pendientes` : ""}`;
  }).join("\n");

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
          { type: "mrkdwn", text: `*Nuevas solicitudes hoy:*\n${newToday}` },
          { type: "mrkdwn", text: `*Total en pipeline:*\n${totalCandidates}` },
          { type: "mrkdwn", text: `*En entrevista:*\n${interviews}` },
          { type: "mrkdwn", text: `*Pendientes de revisión:*\n${pending}` },
          { type: "mrkdwn", text: `*Contratados:*\n${hired}` },
        ],
      },
      ...(processLines ? [{
        type: "section",
        text: { type: "mrkdwn", text: `*Procesos:*\n${processLines}` },
      }] : []),
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
