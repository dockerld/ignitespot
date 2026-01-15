import pkg from "@slack/bolt";
import { logEnvStatus } from "./lib/env.js";
import { registerSlackHandlers } from "./lib/slack/handlers.js";
import { warmCompanyCache } from "./lib/integrations/hubspot.js";
import { warmDoubleClientCache } from "./lib/integrations/double.js";
import { warmAirtableCache } from "./lib/integrations/airtable.js";

const { App, ExpressReceiver } = pkg;

/**
 * IgniteSpot Bot
 *
 * Slack:
 * - Socket Mode: OFF
 * - Slash Command URL: https://<ngrok>/slack/events
 * - Interactivity URL:  https://<ngrok>/slack/events
 * - Select Menus "Options Load URL": set to https://<ngrok>/slack/events (required in your workspace)
 *
 * HubSpot:
 * - Private App token with:
 *   - crm.objects.companies.read
 *   - crm.objects.companies.write
 */

logEnvStatus();

// --------------------
// Receiver
// --------------------

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: true,
});

// Health check
receiver.router.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// Log all HTTP traffic
receiver.router.use((req, _res, next) => {
  console.log(`🌐 ${req.method} ${req.path}`);
  next();
});

// --------------------
// App
// --------------------

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  logLevel: "debug",
});

app.error((err) => {
  console.error("❌ Bolt error:", err);
});

// Log suggestion payloads
app.use(async ({ body, next }) => {
  if (body?.type === "block_suggestion") {
    console.log("✅ Received block_suggestion:", body?.action_id, body?.value);
  }
  await next();
});

registerSlackHandlers(app);

// --------------------
// Start Server
// --------------------

(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ IgniteSpot Bot running on port ${port}`);
  console.log("Health check: http://localhost:3000/healthz");

  warmCompanyCache();
  setInterval(() => {
    warmCompanyCache();
  }, 15 * 60 * 1000);

  warmDoubleClientCache();
  setInterval(() => {
    warmDoubleClientCache();
  }, 15 * 60 * 1000);

  warmAirtableCache();
  setInterval(() => {
    warmAirtableCache();
  }, 15 * 60 * 1000);
})();
