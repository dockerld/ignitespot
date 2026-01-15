import { pageInProgressView, toolPickerView, updateClientView } from "./views.js";
import {
  formatHubSpotOption,
  searchHubSpotCompanies,
  updateHubSpotIndustry,
} from "../integrations/hubspot.js";
import {
  formatDoubleClientOption,
  searchDoubleClients,
  updateDoubleClientDetails,
} from "../integrations/double.js";
import {
  formatAirtableOption,
  searchAirtableRecords,
  updateAirtableRecord,
} from "../integrations/airtable.js";
import { AIRTABLE_UPDATE_FIELD, AIRTABLE_UPDATE_VALUE } from "../env.js";

function openToolPicker(client, trigger_id, userId) {
  return client.views.open({
    trigger_id,
    view: toolPickerView(userId),
  });
}

async function updateModalView(client, body, view) {
  await client.views.update({
    view_id: body.view.id,
    hash: body.view.hash,
    view,
  });
}

async function openPlaceholder(client, body, title) {
  await updateModalView(client, body, pageInProgressView(title));
}

export function registerSlackHandlers(app) {
  app.command("/myhelpbot", async ({ ack, body, client }) => {
    await ack();
    openToolPicker(client, body.trigger_id, body.user_id).catch(console.error);
  });

  app.shortcut("open_helpbot", async ({ ack, body, client }) => {
    await ack();
    openToolPicker(client, body.trigger_id, body.user?.id).catch(console.error);
  });

  app.action("update_client", async ({ ack, body, client }) => {
    await ack();
    await updateModalView(client, body, updateClientView());
  });

  app.action("proposal_change", async ({ ack, body, client }) => {
    await ack();
    await openPlaceholder(client, body, "Proposal Change");
  });

  app.action("new_customer", async ({ ack, body, client }) => {
    await ack();
    await openPlaceholder(client, body, "New Customer");
  });

  app.action("support_ticket", async ({ ack, body, client }) => {
    await ack();
    await openPlaceholder(client, body, "Support Ticket");
  });

  app.action("client_referral", async ({ ack, body, client }) => {
    await ack();
    await openPlaceholder(client, body, "Client Referral");
  });

  app.action("client_loss", async ({ ack, body, client }) => {
    await ack();
    await openPlaceholder(client, body, "Client Loss");
  });

  app.view("page_in_progress", async ({ ack, body }) => {
    await ack({
      response_action: "update",
      view: toolPickerView(body.user?.id),
    });
  });

  app.options("company_search", async ({ ack, payload }) => {
    const raw = payload.value || "";
    const query = raw.trim().replace(/\s+/g, " ");
    console.log("🔎 company_search:", query);

    if (query.length < 3) {
      await ack({ options: [] });
      return;
    }

    try {
      const results = await searchHubSpotCompanies(query);
      const options = results.map((company) => formatHubSpotOption(company));
      await ack({ options });
    } catch (err) {
      console.error(
        "❌ HubSpot search error:",
        err?.response?.status,
        err?.response?.data || err
      );
      await ack({ options: [] });
    }
  });

  app.options("double_client_search", async ({ ack, payload }) => {
    const raw = payload.value || "";
    const query = raw.trim().replace(/\s+/g, " ");
    console.log("🔎 double_client_search:", query);

    if (query.length < 3) {
      await ack({ options: [] });
      return;
    }

    try {
      const results = await searchDoubleClients(query);
      const options = results.map((client) => formatDoubleClientOption(client));
      await ack({ options });
    } catch (err) {
      console.error(
        "❌ Double search error:",
        err?.response?.status,
        err?.response?.data || err
      );
      await ack({ options: [] });
    }
  });

  app.options("airtable_record_search", async ({ ack, payload }) => {
    const raw = payload.value || "";
    const query = raw.trim().replace(/\s+/g, " ");
    console.log("🔎 airtable_record_search:", query);

    if (query.length < 3) {
      await ack({ options: [] });
      return;
    }

    try {
      const results = await searchAirtableRecords(query);
      const options = results.map((record) => formatAirtableOption(record));
      await ack({ options });
    } catch (err) {
      console.error(
        "❌ Airtable search error:",
        err?.response?.status,
        err?.response?.data || err
      );
      await ack({ options: [] });
    }
  });

  app.view("update_client_submit", async ({ ack, body, view, client }) => {
    await ack();

    const companyId =
      view.state.values.company?.company_search?.selected_option?.value;
    const doubleClientId =
      view.state.values.double_client?.double_client_search?.selected_option?.value;
    const airtableRecordId =
      view.state.values.airtable_record?.airtable_record_search?.selected_option
        ?.value;

    const missing = [];
    if (!companyId) missing.push("HubSpot company");
    if (!doubleClientId) missing.push("Double client");
    if (!airtableRecordId) missing.push("Airtable record");

    if (missing.length) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ Missing selection: ${missing.join(", ")}.`,
      });
      return;
    }

    const tasks = [
      {
        name: "HubSpot",
        successText: "✅ HubSpot updated: Industry -> Accounting",
        run: () => updateHubSpotIndustry(companyId),
      },
      {
        name: "Double",
        successText: "✅ Double updated: Details set to Slack TEst worked",
        run: () => updateDoubleClientDetails(doubleClientId, "<p>Slack TEst worked</p>"),
      },
      {
        name: "Airtable",
        successText: `✅ Airtable updated: ${AIRTABLE_UPDATE_FIELD || "field"} set to ${
          AIRTABLE_UPDATE_VALUE || "value"
        }`,
        run: () => updateAirtableRecord(airtableRecordId),
      },
    ];

    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    const lines = [];

    results.forEach((result, index) => {
      const name = tasks[index].name;
      if (result.status === "fulfilled") {
        lines.push(tasks[index].successText);
      } else {
        console.error(`❌ ${name} update error:`, result.reason);
        lines.push(`❌ ${name} update failed. Check logs.`);
      }
    });

    await client.chat.postMessage({
      channel: body.user.id,
      text: lines.join("\n"),
    });
  });
}
