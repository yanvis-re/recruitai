// api/slack/callback.js
// Handles the OAuth callback from Slack, exchanges code for webhook URL,
// then redirects back to the app with the webhook pre-filled.
// Required Vercel env vars: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, APP_URL
export default async function handler(req, res) {
  const { code, error } = req.query;
  const appUrl = process.env.APP_URL || "https://recruitai-smoky.vercel.app";

  if (error || !code) {
    // User cancelled or error occurred — go back to app
    return res.redirect(`${appUrl}?slackError=cancelled`);
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = `${appUrl}/api/slack/callback`;

  if (!clientId || !clientSecret) {
    return res.redirect(`${appUrl}?slackError=not_configured`);
  }

  try {
    // Exchange code for access token
    const resp = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const data = await resp.json();

    if (!data.ok) {
      console.error("Slack OAuth error:", data.error);
      return res.redirect(`${appUrl}?slackError=${encodeURIComponent(data.error)}`);
    }

    const webhookUrl = data.incoming_webhook?.url || "";
    const channel = data.incoming_webhook?.channel || "";

    // Redirect back to app with webhook info as query params.
    // The frontend will detect these, save to Firestore, and clean the URL.
    const params = new URLSearchParams({
      slackConnected: "1",
      slackWebhook: webhookUrl,
      slackChannel: channel,
    });
    return res.redirect(`${appUrl}?${params.toString()}`);
  } catch (e) {
    console.error("Slack callback exception:", e);
    return res.redirect(`${appUrl}?slackError=server_error`);
  }
}
