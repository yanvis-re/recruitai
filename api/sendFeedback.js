// api/sendFeedback.js
//
// Forwards in-app feedback to the product owner's Slack (one central channel
// for the entire beta). Deliberately uses a single FEEDBACK_SLACK_WEBHOOK env
// var, NOT the user's own recruiter webhook — during beta we want everyone's
// feedback to land in the same place.
//
// Required Vercel env var:
//   FEEDBACK_SLACK_WEBHOOK — incoming webhook URL from api.slack.com/apps

const TYPE_CONFIG = {
  bug:      { icon: "🐛", label: "Bug reportado" },
  idea:     { icon: "💡", label: "Idea / Mejora" },
  confused: { icon: "😕", label: "Algo confuso" },
  love:     { icon: "❤️", label: "Feedback positivo" },
};

function buildMessage({ type, message, url, userAgent, userEmail, userName, viewport }) {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.idea;
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${cfg.icon} ${cfg.label}`, emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `>${message.trim().replace(/\n/g, "\n>")}` },
      },
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
        elements: [{
          type: "mrkdwn",
          text: `_${(userAgent || "").slice(0, 200)}_ · ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}`,
        }],
      },
    ],
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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
  // Soft length cap — Slack blocks over ~3000 chars per text field.
  if (message.length > 2500) {
    return res.status(400).json({ error: "Mensaje demasiado largo (máx. 2500 caracteres)." });
  }

  try {
    const slackMessage = buildMessage(req.body);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackMessage),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error("Slack webhook rejected feedback:", text);
      return res.status(500).json({ error: `Slack error: ${text}` });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("sendFeedback error:", err);
    return res.status(500).json({ error: err.message });
  }
}
