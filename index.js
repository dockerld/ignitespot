import pkg from "@slack/bolt";
import express from "express";
import { logEnvStatus, SUPPORT_TICKET_WEBHOOK_SECRET } from "./lib/env.js";
import { registerSlackHandlers } from "./lib/slack/handlers.js";
import { warmCompanyCache } from "./lib/integrations/hubspot.js";
import { warmDoubleClientCache } from "./lib/integrations/double.js";
import { warmAirtableCache } from "./lib/integrations/airtable.js";
import { handleAirtableWebhook } from "./lib/webhooks/airtable.js";
import { handleHubSpotWebhook } from "./lib/webhooks/hubspot.js";
import { handleSupportTicketWebhook } from "./lib/webhooks/supportTicket.js";

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

// Log all HTTP traffic
receiver.router.use((req, _res, next) => {
  console.log(`🌐 ${req.method} ${req.path}`);
  next();
});

// Health check
receiver.router.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// Airtable webhook (automations/webhooks)
receiver.router.post(
  "/webhooks/airtable",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    try {
      const recordId = req.body?.record?.id;
      console.log("📨 Airtable webhook received", recordId ? `(${recordId})` : "");
      const result = await handleAirtableWebhook(req.body, req.headers);
      res.status(200).json({ status: "ok", ...result });
    } catch (err) {
      const status = err?.statusCode || 500;
      console.error("❌ Airtable webhook error:", err?.message || err);
      res.status(status).json({ status: "error" });
    }
  }
);

// HubSpot workflow webhook
receiver.router.post(
  "/webhooks/hubspot",
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
  async (req, res) => {
    try {
      console.log("📨 HubSpot webhook received");
      const sanitizedHeaders = { ...req.headers };
      if (sanitizedHeaders.authorization) {
        sanitizedHeaders.authorization = sanitizedHeaders.authorization.startsWith(
          "Bearer "
        )
          ? "Bearer ***"
          : "***";
      }
      if (sanitizedHeaders["x-webhook-secret"]) {
        sanitizedHeaders["x-webhook-secret"] = "***";
      }
      if (sanitizedHeaders.hubspot_webhook_secret) {
        sanitizedHeaders.hubspot_webhook_secret = "***";
      }
      const dealId = req.body?.objectId || req.body?.properties?.hs_object_id?.value;
      const companyId = req.body?.properties?.hs_primary_associated_company?.value;
      const propertiesCount = Object.keys(req.body?.properties || {}).length;
      console.log("🔐 HubSpot headers summary:", {
        "x-hubspot-correlation-id": sanitizedHeaders["x-hubspot-correlation-id"],
        "content-length": sanitizedHeaders["content-length"],
        "user-agent": sanitizedHeaders["user-agent"],
      });
      const result = await handleHubSpotWebhook(req.body, req.headers);
      res.status(200).json({ status: "ok", ...result });
    } catch (err) {
      const status = err?.statusCode || 500;
      console.error("❌ HubSpot webhook error:", err?.message || err);
      res.status(status).json({ status: "error" });
    }
  }
);

// HubSpot update-only webhook
receiver.router.post(
  "/webhooks/hubspot-update",
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
  async (req, res) => {
    try {
      console.log("📨 HubSpot update webhook received");
      const sanitizedHeaders = { ...req.headers };
      if (sanitizedHeaders.authorization) {
        sanitizedHeaders.authorization = sanitizedHeaders.authorization.startsWith(
          "Bearer "
        )
          ? "Bearer ***"
          : "***";
      }
      if (sanitizedHeaders["x-webhook-secret"]) {
        sanitizedHeaders["x-webhook-secret"] = "***";
      }
      if (sanitizedHeaders.hubspot_webhook_secret) {
        sanitizedHeaders.hubspot_webhook_secret = "***";
      }
      const dealId = req.body?.objectId || req.body?.properties?.hs_object_id?.value;
      const companyId = req.body?.properties?.hs_primary_associated_company?.value;
      const propertiesCount = Object.keys(req.body?.properties || {}).length;
      console.log("🔐 HubSpot headers summary:", {
        "x-hubspot-correlation-id": sanitizedHeaders["x-hubspot-correlation-id"],
        "content-length": sanitizedHeaders["content-length"],
        "user-agent": sanitizedHeaders["user-agent"],
      });
      const result = await handleHubSpotWebhook(req.body, req.headers, {
        updateOnly: true,
      });
      res.status(200).json({ status: "ok", ...result });
    } catch (err) {
      const status = err?.statusCode || 500;
      console.error("❌ HubSpot update webhook error:", err?.message || err);
      res.status(status).json({ status: "error" });
    }
  }
);

// --------------------
// App
// --------------------

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  logLevel: "debug",
});

// Support ticket webhook (from Google Apps Script)
receiver.router.post(
  "/webhooks/support-ticket",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    try {
      const result = await handleSupportTicketWebhook(req.body, req.headers, {
        slackClient: app.client,
        secret: SUPPORT_TICKET_WEBHOOK_SECRET,
      });
      res.status(200).json({ status: "ok", ...result });
    } catch (err) {
      const status = err?.statusCode || 500;
      console.error("❌ Support ticket webhook error:", err?.message || err);
      res.status(status).json({ status: "error" });
    }
  }
);

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
