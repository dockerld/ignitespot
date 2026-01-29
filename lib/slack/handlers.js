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
  createHubSpotCompany,
  createHubSpotContact,
  createHubSpotDeal,
  associateContactToCompany,
  associateDealToCompany,
  associateDealToContact,
  ensureHubSpotObjectsReady,
  updateHubSpotDealHearAboutUs,
  updateHubSpotDealTypeForCompany,
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
  updateAirtableRecordFields,
} from "../integrations/airtable.js";
import {
  HUBSPOT_PORTAL_ID,
  AIRTABLE_CLIENT_SOFTWARE_TABLE_ID,
  SLACK_DEFAULT_CHANNEL_ID,
  SLACK_DEFAULT_MENTION_USER_ID,
  SLACK_PROPOSAL_CHANGE_CHANNEL,
  SLACK_PROPOSAL_CHANGE_REVIEWER_ID,
} from "../env.js";

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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
    const companyId = values.company?.company_search?.selected_option?.value || "";
    const dealType =
      values.deal_type?.deal_type_search?.selected_option?.text?.text ||
      "Not set";
    const notes = values.proposal_notes?.proposal_notes_input?.value || "None";

    const requesterId = body.user?.id || "";
    const requesterName = body.user?.name || body.user?.username || "Unknown";
    const mentionValues = [];
    if (requesterId) {
      mentionValues.push(`<@${requesterId}>`);
    } else if (requesterName) {
      mentionValues.push(requesterName);
    }
    if (SLACK_PROPOSAL_CHANGE_REVIEWER_ID) {
      mentionValues.push(`<@${SLACK_PROPOSAL_CHANGE_REVIEWER_ID}>`);
    } else {
      mentionValues.push("@docker");
    }
    const mentions = Array.from(new Set(mentionValues)).join(" ");
    const hubspotLink =
      HUBSPOT_PORTAL_ID && companyId
        ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/company/${companyId}`
        : "";
    const headerText = `${mentions} 👋 Your proposal change request was submitted.\nUpdates will be posted as a thread in this message.${
      hubspotLink ? ` <${hubspotLink}|View Deal in HubSpot>` : ""
    }`;

    await client.chat.postMessage({
      channel: SLACK_PROPOSAL_CHANGE_CHANNEL,
      text: `Proposal change request submitted by ${requesterName}.`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: headerText },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Requested by:* ${requesterName}` },
            { type: "mrkdwn", text: `*Company Name:* ${company}` },
            { type: "mrkdwn", text: `*Deal Type:* ${dealType}` },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Notes:* ${notes}` },
        },
        ...(hubspotLink
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `<${hubspotLink}|View Deal in HubSpot>`,
                },
              },
            ]
          : []),
      ],
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
    const hearAboutUsOption =
      values.hear_about_us?.hear_about_us_search?.selected_option || null;
    const hearAboutUsLabel = hearAboutUsOption?.text?.text || "Not set";
    const hearAboutUsValue = hearAboutUsOption?.value || hearAboutUsLabel;
    const notes = values.customer_notes?.customer_notes_input?.value || "None";

    let company = null;
    let contact = null;
    let deal = null;
    let contactCompany = { associated: false, reason: "not_attempted" };
    let dealCompany = { associated: false, reason: "not_attempted" };
    let dealContact = { associated: false, reason: "not_attempted" };
    let hearAboutUsUpdate = { updated: false, reason: "not_attempted" };

    try {
      company = await createHubSpotCompany({ name: companyName });
    } catch (err) {
      console.error(
        "❌ HubSpot create company error:",
        err?.response?.status,
        err?.response?.data || err
      );
    }

    try {
      contact = await createHubSpotContact({
        firstname: firstName,
        lastname: lastName,
        email,
      });
    } catch (err) {
      console.error(
        "❌ HubSpot create contact error:",
        err?.response?.status,
        err?.response?.data || err
      );
    }

    try {
      deal = await createHubSpotDeal({ dealname: companyName });
    } catch (err) {
      console.error(
        "❌ HubSpot create deal error:",
        err?.response?.status,
        err?.response?.data || err
      );
    }

    if (company?.id || contact?.id || deal?.id) {
      await ensureHubSpotObjectsReady({
        companyId: company?.id,
        contactId: contact?.id,
        dealId: deal?.id,
      });
    }

    if (contact?.id && company?.id) {
      contactCompany = await associateContactToCompany(contact.id, company.id);
    }

    if (deal?.id && company?.id) {
      dealCompany = await associateDealToCompany(deal.id, company.id);
    }

    if (deal?.id && contact?.id) {
      dealContact = await associateDealToContact(deal.id, contact.id);
    }

    if (deal?.id && hearAboutUsValue && hearAboutUsValue !== "Not set") {
      try {
        hearAboutUsUpdate = await updateHubSpotDealHearAboutUs(
          deal.id,
          hearAboutUsValue
        );
      } catch (err) {
        console.error(
          "❌ HubSpot hear-about-us update error:",
          err?.response?.status,
          err?.response?.data || err
        );
        hearAboutUsUpdate = { updated: false, reason: "error" };
      }
    } else {
      hearAboutUsUpdate = { updated: false, reason: "missing_value" };
    }

    const requesterId = body.user?.id || "";
    const requesterName = body.user?.name || body.user?.username || "Unknown";
    const mentionValues = [];
    if (requesterId) {
      mentionValues.push(`<@${requesterId}>`);
    } else if (requesterName) {
      mentionValues.push(requesterName);
    }
    if (SLACK_DEFAULT_MENTION_USER_ID) {
      mentionValues.push(`<@${SLACK_DEFAULT_MENTION_USER_ID}>`);
    } else {
      mentionValues.push("@docker");
    }
    const mentions = Array.from(new Set(mentionValues)).join(" ");
    const hubspotLink =
      HUBSPOT_PORTAL_ID && deal?.id
        ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${deal.id}`
        : "";
    const headerText = `${mentions} 👋 Your new customer request was submitted. Updates will be posted as a thread in this message.${
      hubspotLink ? ` <${hubspotLink}|View Deal in HubSpot>` : ""
    }`;
    const detailLine1 = `*Requested by:* ${requesterName}  *Company Name:* ${companyName}`;
    const detailLine2 = `*Client First Name:* ${firstName}  *Client Last Name:* ${lastName}`;
    const detailLine3 = `*Client Email:* ${email}`;
    const detailLine4 = `*How did you hear about us:* ${hearAboutUsLabel}`;
    const notesLine = `*Notes:* ${notes}`;
    const associationStatus = (label, result) =>
      result.associated
        ? `${label} linked`
        : `${label} ${result.reason || "skipped"}`;
    const statusLine = `*HubSpot:* company ${
      company?.id ? "created" : "failed"
    }, contact ${contact?.id ? "created" : "failed"}, deal ${
      deal?.id ? "created" : "failed"
    } | ${associationStatus("contact→company", contactCompany)}, ${associationStatus(
      "deal→company",
      dealCompany
    )}, ${associationStatus("deal→contact", dealContact)} | hear-about-us ${
      hearAboutUsUpdate.updated ? "updated" : "skipped"
    }`;

    await client.chat.postMessage({
      channel: SLACK_DEFAULT_CHANNEL_ID || body.user.id,
      text: "New customer request received.",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: headerText } },
        { type: "context", elements: [{ type: "mrkdwn", text: detailLine1 }] },
        { type: "context", elements: [{ type: "mrkdwn", text: detailLine2 }] },
        { type: "context", elements: [{ type: "mrkdwn", text: detailLine3 }] },
        { type: "context", elements: [{ type: "mrkdwn", text: detailLine4 }] },
        { type: "context", elements: [{ type: "mrkdwn", text: notesLine }] },
        { type: "context", elements: [{ type: "mrkdwn", text: statusLine }] },
        ...(hubspotLink
          ? [
              {
                type: "section",
                text: { type: "mrkdwn", text: `<${hubspotLink}|View Deal in HubSpot>` },
              },
            ]
          : []),
      ],
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

    let company = null;
    let contact = null;
    let deal = null;
    let contactCompany = { associated: false, reason: "not_attempted" };
    let dealCompany = { associated: false, reason: "not_attempted" };
    let dealContact = { associated: false, reason: "not_attempted" };

    try {
      company = await createHubSpotCompany({ name: companyName });
    } catch (err) {
      console.error(
        "❌ HubSpot create company error:",
        err?.response?.status,
        err?.response?.data || err
      );
    }

    try {
      contact = await createHubSpotContact({
        firstname: firstName,
        lastname: lastName,
        email,
      });
    } catch (err) {
      console.error(
        "❌ HubSpot create contact error:",
        err?.response?.status,
        err?.response?.data || err
      );
    }

    try {
      deal = await createHubSpotDeal({ dealname: companyName });
    } catch (err) {
      console.error(
        "❌ HubSpot create deal error:",
        err?.response?.status,
        err?.response?.data || err
      );
    }

    if (company?.id || contact?.id || deal?.id) {
      await ensureHubSpotObjectsReady({
        companyId: company?.id,
        contactId: contact?.id,
        dealId: deal?.id,
      });
    }

    if (contact?.id && company?.id) {
      contactCompany = await associateContactToCompany(contact.id, company.id);
    }

    if (deal?.id && company?.id) {
      dealCompany = await associateDealToCompany(deal.id, company.id);
    }

    if (deal?.id && contact?.id) {
      dealContact = await associateDealToContact(deal.id, contact.id);
    }

    const requesterId = body.user?.id || "";
    const requesterName = body.user?.name || body.user?.username || "Unknown";
    const mentionValues = [];
    if (requesterId) {
      mentionValues.push(`<@${requesterId}>`);
    } else if (requesterName) {
      mentionValues.push(requesterName);
    }
    if (SLACK_DEFAULT_MENTION_USER_ID) {
      mentionValues.push(`<@${SLACK_DEFAULT_MENTION_USER_ID}>`);
    } else {
      mentionValues.push("@docker");
    }
    const mentions = mentionValues.join(" ");
    const hubspotLink =
      HUBSPOT_PORTAL_ID && deal?.id
        ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${deal.id}`
        : "";
    const headerText = `${mentions} 👋 Your new client referral was submitted. Updates will be posted as a thread in this message.${
      hubspotLink ? ` <${hubspotLink}|View Deal in HubSpot>` : ""
    }`;
    const detailLine1 = `*Requested by:* ${requesterName}  *Company Name:* ${companyName}`;
    const detailLine2 = `*Client First Name:* ${firstName}  *Client Last Name:* ${lastName}`;
    const detailLine3 = `*Client Email:* ${email}`;
    const notesLine = `*Notes:* ${notes}`;
    const associationStatus = (label, result) =>
      result.associated
        ? `${label} linked`
        : `${label} ${result.reason || "skipped"}`;
    const statusLine = `*HubSpot:* company ${
      company?.id ? "created" : "failed"
    }, contact ${contact?.id ? "created" : "failed"}, deal ${
      deal?.id ? "created" : "failed"
    } | ${associationStatus("contact→company", contactCompany)}, ${associationStatus(
      "deal→company",
      dealCompany
    )}, ${associationStatus("deal→contact", dealContact)}`;

    await client.chat.postMessage({
      channel: SLACK_DEFAULT_CHANNEL_ID || body.user.id,
      text: "Client referral request received.",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: headerText } },
        { type: "context", elements: [{ type: "mrkdwn", text: detailLine1 }] },
        { type: "context", elements: [{ type: "mrkdwn", text: detailLine2 }] },
        { type: "context", elements: [{ type: "mrkdwn", text: detailLine3 }] },
        { type: "context", elements: [{ type: "mrkdwn", text: notesLine }] },
        { type: "context", elements: [{ type: "mrkdwn", text: statusLine }] },
        ...(hubspotLink
          ? [
              {
                type: "section",
                text: { type: "mrkdwn", text: `<${hubspotLink}|View Deal in HubSpot>` },
              },
            ]
          : []),
      ],
    });
  });

  app.view("client_loss_submit", async ({ ack, body, view, client }) => {
    await ack();

    const values = view.state.values || {};
    const hubspotCompany =
      values.hubspot_company?.company_search?.selected_option?.text?.text ||
      "Not set";
    const hubspotCompanyId =
      values.hubspot_company?.company_search?.selected_option?.value || "";
    const keeperCompany =
      values.keeper_company?.double_client_search?.selected_option?.text?.text ||
      "Not set";
    const airtableCompany =
      values.airtable_company?.airtable_record_search?.selected_option?.text?.text ||
      "Not set";
    const airtableRecordId =
      values.airtable_company?.airtable_record_search?.selected_option?.value ||
      "";
    const dealType =
      values.deal_type?.deal_type_static?.selected_option?.text?.text ||
      "Not set";
    const notes =
      values.client_loss_notes?.client_loss_notes_input?.value || "None";

    let hubspotUpdate = { updated: false, reason: "missing_company_id" };
    if (hubspotCompanyId) {
      try {
        hubspotUpdate = await updateHubSpotDealTypeForCompany(
          hubspotCompanyId,
          "Client Loss"
        );
      } catch (err) {
        console.error(
          "❌ HubSpot deal type update error:",
          err?.response?.status,
          err?.response?.data || err
        );
        hubspotUpdate = { updated: false, reason: "error" };
      }
    }

    let airtableUpdate = { updated: false, reason: "missing_record_id" };
    if (airtableRecordId) {
      try {
        await updateAirtableRecordFields(airtableRecordId, {
          "Close Out": "Disengaging",
        }, AIRTABLE_CLIENT_SOFTWARE_TABLE_ID);
        airtableUpdate = { updated: true, recordId: airtableRecordId };
      } catch (err) {
        console.error(
          "❌ Airtable close out update error:",
          err?.response?.status,
          err?.response?.data || err
        );
        airtableUpdate = { updated: false, reason: "error" };
      }
    }

    const requesterId = body.user?.id || "";
    const requesterName = body.user?.name || body.user?.username || "Unknown";
    const mentionValues = [];
    if (requesterId) {
      mentionValues.push(`<@${requesterId}>`);
    } else if (requesterName) {
      mentionValues.push(requesterName);
    }
    if (SLACK_DEFAULT_MENTION_USER_ID) {
      mentionValues.push(`<@${SLACK_DEFAULT_MENTION_USER_ID}>`);
    } else {
      mentionValues.push("@docker");
    }
    const requesterMention = mentionValues.join(" ");
    const hubspotLink =
      HUBSPOT_PORTAL_ID && hubspotCompanyId
        ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/company/${hubspotCompanyId}`
        : "";
    const headerText = `${requesterMention} 👋 Your client loss request was submitted. Updates will be posted as a thread in this message.${
      hubspotLink ? ` <${hubspotLink}|View Deal in HubSpot>` : ""
    }`;
    const detailText = `*Requested by:* ${requesterName}  *Company Name:* ${hubspotCompany}  *Deal Type:* ${dealType}`;
    const notesText = `*Notes:* ${notes}`;
    const statusText = `*HubSpot update:* ${
      hubspotUpdate.updated
        ? `updated (${hubspotUpdate.dealId || "deal"})`
        : `skipped (${hubspotUpdate.reason})`
    }  *Airtable update:* ${
      airtableUpdate.updated ? "updated" : `skipped (${airtableUpdate.reason})`
    }`;

    await client.chat.postMessage({
      channel: SLACK_DEFAULT_CHANNEL_ID || "C0A955WRK6Y",
      text: "Client loss change order received.",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: headerText },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: detailText }],
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: notesText }],
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: statusText }],
        },
        ...(hubspotLink
          ? [
              {
                type: "section",
                text: { type: "mrkdwn", text: `<${hubspotLink}|View Deal in HubSpot>` },
              },
            ]
          : []),
      ],
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
      const filtered = options.filter((option) => {
        const label = option?.text?.text || "";
        const value = option?.value || "";
        const normalized = `${label} ${value}`.toLowerCase();
        return !normalized.includes("client loss");
      });
      await ack({ options: filtered });
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
      const airtableOverrides = {
        searchFields: ["Group Name"],
        displayField: "Group Name",
        secondaryField: "",
      };
      const results = await searchAirtableRecords(
        query,
        AIRTABLE_CLIENT_SOFTWARE_TABLE_ID,
        airtableOverrides
      );
      const options = results.map((record) =>
        formatAirtableOption(record, airtableOverrides)
      );
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
