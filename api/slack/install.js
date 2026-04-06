// api/slack/install.js
// Redirects the user to Slack's OAuth authorization page.
// Required Vercel env vars: SLACK_CLIENT_ID, APP_URL
export default function handler(req, res) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send(
      "<h2>Slack no configurado</h2><p>Falta la variable de entorno <code>SLACK_CLIENT_ID</code> en Vercel.</p>"
    );
  }
  const appUrl = process.env.APP_URL || "https://recruitai-smoky.vercel.app";
  const redirectUri = `${appUrl}/api/slack/callback`;
  const scopes = "incoming-webhook";

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("redirect_uri", redirectUri);

  res.redirect(url.toString());
}
