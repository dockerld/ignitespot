import {
  clientReferralView,
  clientLossChangeOrderView,
  pageInProgressView,
  newCustomerView,
  proposalChangeView,
  toolPickerView,
} from "./views.js";
import {
  formatHubSpotOption,
  searchHubSpotHearAboutUsOptions,
  searchHubSpotDealTypes,
  searchHubSpotCompanies,
} from "../integrations/hubspot.js";
import {
  formatDoubleClientOption,
  searchDoubleClients,
} from "../integrations/double.js";
import {
  formatAirtableOption,
  searchAirtableRecords,
} from "../integrations/airtable.js";

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

function isValidEmail(value) {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);
}

function hasAnyInput(values) {
  if (!values) return false;
  return Object.values(values).some((block) =>
    Object.values(block).some((field) => {
      if (!field) return false;
      if (typeof field.value === "string" && field.value.trim()) return true;
      if (Array.isArray(field.selected_options) && field.selected_options.length)
        return true;
      if (field.selected_option) return true;
      if (field.selected_user) return true;
      if (Array.isArray(field.selected_users) && field.selected_users.length)
        return true;
      if (field.selected_conversation) return true;
      if (field.selected_channel) return true;
      if (field.selected_date || field.selected_time) return true;
      return false;
    })
  );
}

function viewHasBackConfirm(view) {
  if (!view?.blocks) return false;
  for (const block of view.blocks) {
    const accessory = block?.accessory;
    if (accessory?.action_id === "go_back") {
      return !!accessory.confirm;
    }
    const elements = block?.elements || [];
    for (const element of elements) {
      if (element?.action_id === "go_back") {
        return !!element.confirm;
      }
    }
  }
  return false;
}

function getViewWithBackConfirm(callbackId) {
  switch (callbackId) {
    case "proposal_change_submit":
      return proposalChangeView({ confirmBack: true });
    case "new_customer_submit":
      return newCustomerView({ confirmBack: true });
    case "client_referral_submit":
      return clientReferralView({ confirmBack: true });
    case "client_loss_submit":
      return clientLossChangeOrderView({ confirmBack: true });
    default:
      return null;
  }
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

  app.action("go_back", async ({ ack, body, client }) => {
    await ack();
    const values = body.view?.state?.values;
    const needsConfirm = hasAnyInput(values);

    if (!needsConfirm) {
      await updateModalView(client, body, toolPickerView(body.user?.id));
      return;
    }

    if (viewHasBackConfirm(body.view)) {
      await updateModalView(client, body, toolPickerView(body.user?.id));
      return;
    }

    const confirmView = getViewWithBackConfirm(body.view?.callback_id);
    if (confirmView) {
      await updateModalView(client, body, confirmView);
    }
  });

  app.action("proposal_change", async ({ ack, body, client }) => {
    await ack();
    await updateModalView(client, body, proposalChangeView());
  });

  app.action("new_customer", async ({ ack, body, client }) => {
    await ack();
    await updateModalView(client, body, newCustomerView());
  });

  app.action("support_ticket", async ({ ack, body, client }) => {
    await ack();
    await openPlaceholder(client, body, "Support Ticket");
  });

  app.action("client_referral", async ({ ack, body, client }) => {
    await ack();
    await updateModalView(client, body, clientReferralView());
  });

  app.action("client_loss", async ({ ack, body, client }) => {
    await ack();
    await updateModalView(client, body, clientLossChangeOrderView());
  });

  app.view("page_in_progress", async ({ ack, body }) => {
    await ack({
      response_action: "update",
      view: toolPickerView(body.user?.id),
    });
  });

  app.view("proposal_change_submit", async ({ ack, body, view, client }) => {
    const values = view.state.values || {};
    const proposalEmail = values.proposal_email?.proposal_email_input?.value || "";
    const errors = {};

    if (!proposalEmail || !isValidEmail(proposalEmail)) {
      errors.proposal_email = "Enter a valid email address.";
    }

    if (Object.keys(errors).length) {
      await ack({ response_action: "errors", errors });
      return;
    }

    await ack();

    const company =
      values.company?.company_search?.selected_option?.text?.text || "Not set";
    const dealType =
      values.deal_type?.deal_type_search?.selected_option?.text?.text ||
      "Not set";
    const notes = values.proposal_notes?.proposal_notes_input?.value || "None";

    await client.chat.postMessage({
      channel: body.user.id,
      text:
        "Proposal change request received.\n" +
        `Company: ${company}\n` +
        `Deal type: ${dealType}\n` +
        `Email: ${proposalEmail}\n` +
        `Notes: ${notes}`,
    });
  });

  app.view("new_customer_submit", async ({ ack, body, view, client }) => {
    await ack();

    const values = view.state.values || {};
    const companyName =
      values.customer_company_name?.customer_company_name_input?.value ||
      "Not set";
    const firstName =
      values.customer_first_name?.customer_first_name_input?.value || "Not set";
    const lastName =
      values.customer_last_name?.customer_last_name_input?.value || "Not set";
    const email =
      values.customer_email?.customer_email_input?.value || "Not set";
    const hearAboutUs =
      values.hear_about_us?.hear_about_us_search?.selected_option?.text?.text ||
      "Not set";
    const notes = values.customer_notes?.customer_notes_input?.value || "None";

    await client.chat.postMessage({
      channel: body.user.id,
      text:
        "New customer request received.\n" +
        `Company: ${companyName}\n` +
        `First name: ${firstName}\n` +
        `Last name: ${lastName}\n` +
        `Email: ${email}\n` +
        `How did you hear about us: ${hearAboutUs}\n` +
        `Notes: ${notes}`,
    });
  });

  app.view("client_referral_submit", async ({ ack, body, view, client }) => {
    await ack();

    const values = view.state.values || {};
    const companyName =
      values.referral_company_name?.referral_company_name_input?.value ||
      "Not set";
    const firstName =
      values.referral_first_name?.referral_first_name_input?.value || "Not set";
    const lastName =
      values.referral_last_name?.referral_last_name_input?.value || "Not set";
    const email =
      values.referral_email?.referral_email_input?.value || "Not set";
    const notes = values.referral_notes?.referral_notes_input?.value || "None";

    await client.chat.postMessage({
      channel: body.user.id,
      text:
        "Client referral request received.\n" +
        `Company: ${companyName}\n` +
        `First name: ${firstName}\n` +
        `Last name: ${lastName}\n` +
        `Email: ${email}\n` +
        `Notes: ${notes}`,
    });
  });

  app.view("client_loss_submit", async ({ ack, body, view, client }) => {
    await ack();

    const values = view.state.values || {};
    const hubspotCompany =
      values.hubspot_company?.company_search?.selected_option?.text?.text ||
      "Not set";
    const keeperCompany =
      values.keeper_company?.double_client_search?.selected_option?.text?.text ||
      "Not set";
    const airtableCompany =
      values.airtable_company?.airtable_record_search?.selected_option?.text?.text ||
      "Not set";
    const dealType =
      values.deal_type?.deal_type_static?.selected_option?.text?.text ||
      "Not set";
    const notes =
      values.client_loss_notes?.client_loss_notes_input?.value || "None";

    await client.chat.postMessage({
      channel: body.user.id,
      text:
        "Client loss change order received.\n" +
        `HubSpot company: ${hubspotCompany}\n` +
        `Keeper company: ${keeperCompany}\n` +
        `Airtable company: ${airtableCompany}\n` +
        `Deal type: ${dealType}\n` +
        `Notes: ${notes}`,
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

  app.options("hear_about_us_search", async ({ ack, payload }) => {
    const raw = payload.value || "";
    const query = raw.trim().replace(/\s+/g, " ");
    console.log("🔎 hear_about_us_search:", query);

    try {
      const options = await searchHubSpotHearAboutUsOptions(query);
      await ack({ options });
    } catch (err) {
      console.error(
        "❌ HubSpot hear-about-us error:",
        err?.response?.status,
        err?.response?.data || err
      );
      await ack({ options: [] });
    }
  });

  app.options("deal_type_search", async ({ ack, payload }) => {
    const raw = payload.value || "";
    const query = raw.trim().replace(/\s+/g, " ");
    console.log("🔎 deal_type_search:", query);

    try {
      const options = await searchHubSpotDealTypes(query);
      await ack({ options });
    } catch (err) {
      console.error(
        "❌ HubSpot deal type error:",
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

}
