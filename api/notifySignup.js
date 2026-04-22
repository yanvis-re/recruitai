// api/notifySignup.js
//
// Posts a 'new signup' alert to the owner's Slack so Yan sees every new
// registration in real time and can approve/reject from the admin panel.
// Reuses the same FEEDBACK_SLACK_WEBHOOK that catches beta feedback — one
// central stream of actionable events during the beta.
//
// Body: { email, displayName, uid, provider }
// No auth required (called from client fire-and-forget right after signup).

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const webhookUrl = process.env.FEEDBACK_SLACK_WEBHOOK;
  if (!webhookUrl) {
    console.warn("FEEDBACK_SLACK_WEBHOOK not configured — signup notification dropped");
    return res.status(200).json({ success: false, skipped: true });
  }

  const { email, displayName, uid, provider } = req.body || {};
  if (!email && !uid) return res.status(400).json({ error: "Missing email/uid" });

  const message = {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🆕 Nuevo registro en RecruitAI", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Nombre:*\n${displayName || "(sin nombre)"}` },
          { type: "mrkdwn", text: `*Email:*\n${email || "—"}` },
          { type: "mrkdwn", text: `*Proveedor:*\n${provider || "—"}` },
          { type: "mrkdwn", text: `*UID:*\n\`${uid || "—"}\`` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "⏳ *Estado:* pendiente de aprobación en el Panel Admin." },
      },
      { type: "divider" },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `RecruitAI · ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}` }],
      },
    ],
  };

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
    console.error("notifySignup error:", err);
    return res.status(500).json({ error: err.message });
  }
}
