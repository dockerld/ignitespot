import {
  clientReferralView,
  clientLossChangeOrderView,
  pageInProgressView,
  newCustomerView,
  proposalChangeView,
  supportTicketView,
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
  createClientLossDealForCompany,
  getHubSpotPrimaryContactIdForCompany,
  updateHubSpotDealSlackThread,
  searchHubSpotHearAboutUsOptions,
  searchHubSpotDealTypes,
  searchHubSpotCompanies,
} from "../integrations/hubspot.js";
import {
  formatDoubleClientOption,
  searchDoubleClients,
  applyDoubleTaskTemplateToClient,
} from "../integrations/double.js";
import {
  formatAirtableOption,
  searchAirtableRecords,
  updateAirtableRecordFields,
} from "../integrations/airtable.js";
import { appendSupportTicketRow } from "../integrations/googleSheets.js";
import {
  HUBSPOT_PORTAL_ID,
  HUBSPOT_SALES_PIPELINE_ID,
  HUBSPOT_SALES_STAGE_ID,
  HUBSPOT_REFERRAL_PIPELINE_ID,
  HUBSPOT_REFERRAL_STAGE_ID,
  HUBSPOT_PROPOSAL_CHANGE_PIPELINE_ID,
  HUBSPOT_PROPOSAL_CHANGE_STAGE_ID,
  AIRTABLE_CLIENT_SOFTWARE_TABLE_ID,
  SLACK_DEFAULT_CHANNEL_ID,
  SLACK_DEFAULT_MENTION_USER_ID,
  SLACK_SUPPORT_TICKET_CHANNEL_ID,
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

function generateRequestId(length = 10) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
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
    case "support_ticket_submit":
      return supportTicketView({ confirmBack: true });
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
    await updateModalView(client, body, supportTicketView());
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
    const companyLink =
      HUBSPOT_PORTAL_ID && companyId
        ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/company/${companyId}`
        : "";

    let deal = null;
    let primaryContactId = null;
    let dealCompany = { associated: false, reason: "not_attempted" };
    let dealContact = { associated: false, reason: "not_attempted" };

    if (companyId) {
      try {
        primaryContactId = await getHubSpotPrimaryContactIdForCompany(companyId);
      } catch (err) {
        console.error(
          "❌ HubSpot primary contact lookup error:",
          err?.response?.status,
          err?.response?.data || err
        );
      }
    }

    try {
      const dealName = company || "Proposal Change";
      deal = await createHubSpotDeal({
        dealname: dealName,
        pipelineId: HUBSPOT_PROPOSAL_CHANGE_PIPELINE_ID,
        stageId: HUBSPOT_PROPOSAL_CHANGE_STAGE_ID,
      });
    } catch (err) {
      console.error(
        "❌ HubSpot proposal deal create error:",
        err?.response?.status,
        err?.response?.data || err
      );
    }

    if (companyId && deal?.id) {
      dealCompany = await associateDealToCompany(deal.id, companyId);
    }

    if (deal?.id && primaryContactId) {
      dealContact = await associateDealToContact(deal.id, primaryContactId);
    }

    const proposalHubspotLink =
      HUBSPOT_PORTAL_ID && deal?.id
        ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${deal.id}`
        : companyLink;

    const headerText = `${mentions} 👋 Your proposal change request was submitted.\nUpdates will be posted as a thread in this message.${
      proposalHubspotLink
        ? ` <${proposalHubspotLink}|View Deal in HubSpot>`
        : ""
    }`;

    const statusLine = `*HubSpot:* deal ${
      deal?.id ? "created" : "failed"
    }, ${dealCompany.associated ? "linked company" : "company link skipped"}, ${
      dealContact.associated ? "linked contact" : "contact link skipped"
    }`;

    const proposalMessage = await client.chat.postMessage({
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
        {
          type: "section",
          text: { type: "mrkdwn", text: statusLine },
        },
        ...(proposalHubspotLink
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `<${proposalHubspotLink}|View Deal in HubSpot>`,
                },
              },
            ]
          : []),
      ],
    });

    const proposalThreadTs = proposalMessage?.ts || proposalMessage?.message?.ts || "";
    if (deal?.id && proposalThreadTs) {
      try {
        await updateHubSpotDealSlackThread(deal.id, proposalThreadTs);
      } catch (err) {
        console.error(
          "❌ HubSpot proposal slack thread update error:",
          err?.response?.status,
          err?.response?.data || err
        );
      }
    }

    if (proposalThreadTs) {
      await client.chat.postMessage({
        channel: SLACK_PROPOSAL_CHANGE_CHANNEL,
        thread_ts: proposalThreadTs,
        text: "Proposal change request Status = Ticket Received - ✊",
      });
    }
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
      deal = await createHubSpotDeal({
        dealname: companyName,
        pipelineId: HUBSPOT_SALES_PIPELINE_ID,
        stageId: HUBSPOT_SALES_STAGE_ID,
      });
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

    const customerMessage = await client.chat.postMessage({
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

    const customerThreadTs = customerMessage?.ts || customerMessage?.message?.ts || "";
    if (deal?.id && customerThreadTs) {
      try {
        await updateHubSpotDealSlackThread(deal.id, customerThreadTs);
      } catch (err) {
        console.error(
          "❌ HubSpot new customer slack thread update error:",
          err?.response?.status,
          err?.response?.data || err
        );
      }
    }
  });

  app.view("support_ticket_submit", async ({ ack, body, view, client }) => {
    const values = view.state.values || {};
    const companyName =
      values.support_company_manual?.support_company_manual_input?.value || "";
    const typeOption = values.support_type?.support_type_select?.selected_option;
    const priorityOption =
      values.support_priority?.support_priority_select?.selected_option;
    const appsOptions =
      values.support_apps?.support_apps_select?.selected_options || [];
    const notes = values.support_notes?.support_notes_input?.value || "None";

    const errors = {};
    if (!companyName) {
      errors.support_company_manual = "Enter a company name.";
    }
    if (Object.keys(errors).length) {
      await ack({ response_action: "errors", errors });
      return;
    }

    await ack();

    const typeLabel = typeOption?.text?.text || "Not set";
    const priorityLabel = priorityOption?.text?.text || "Not set";
    const appsList = appsOptions.map((opt) => opt?.text?.text).filter(Boolean);
    const appsDisplay = appsList.length ? appsList.join(", ") : "[]";

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

    const requestId = generateRequestId();
    const channelId =
      SLACK_SUPPORT_TICKET_CHANNEL_ID || SLACK_DEFAULT_CHANNEL_ID || body.user.id;
    const headerText = `👋 Hey ${mentions} your support ticket was submitted. Updates will be posted as a thread in this message.`;
    const detailLine1 = `*Company Name:* ${companyName}  *Type:* ${typeLabel}  *Priority:* ${priorityLabel}`;
    const detailLine2 = `*Apps:* ${appsDisplay}  *Notes:* ${notes}  *Ticket ID:* ${requestId}`;

    let message = null;
    try {
      const result = await client.chat.postMessage({
        channel: channelId,
        text: "Support ticket submitted.",
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: headerText } },
          { type: "context", elements: [{ type: "mrkdwn", text: detailLine1 }] },
          { type: "context", elements: [{ type: "mrkdwn", text: detailLine2 }] },
        ],
      });
      message = result?.message || null;
    } catch (err) {
      console.error(
        "❌ Slack support ticket post error:",
        err?.response?.data || err
      );
    }

    if (message?.ts) {
      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: message.ts,
          text: "Support Ticket Status = Not Started",
        });
      } catch (err) {
        console.error(
          "❌ Slack support ticket status post error:",
          err?.response?.data || err
        );
      }
    }

    let permalink = "";
    if (message?.ts) {
      try {
        const permalinkResp = await client.chat.getPermalink({
          channel: channelId,
          message_ts: message.ts,
        });
        permalink = permalinkResp?.permalink || "";
      } catch (err) {
        console.error(
          "❌ Slack support ticket permalink error:",
          err?.response?.data || err
        );
      }
    }

    const slackLinkFormula = permalink
      ? `=HYPERLINK("${permalink}","Slack Message")`
      : "";
    const row = [
      new Date().toISOString(),
      requestId,
      requesterId ? `<@${requesterId}>` : requesterName,
      companyName,
      typeLabel,
      priorityLabel,
      message?.ts || "",
      appsDisplay,
      notes,
      "Not Started",
      "",
      "",
      message?.ts ? "Yes" : "No",
      slackLinkFormula,
    ];

    try {
      await appendSupportTicketRow(row);
    } catch (err) {
      console.error(
        "❌ Google Sheets support ticket append error:",
        err?.response?.data || err
      );
    }
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
      deal = await createHubSpotDeal({
        dealname: companyName,
        pipelineId: HUBSPOT_REFERRAL_PIPELINE_ID,
        stageId: HUBSPOT_REFERRAL_STAGE_ID,
      });
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

    const referralMessage = await client.chat.postMessage({
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

    const referralThreadTs = referralMessage?.ts || referralMessage?.message?.ts || "";
    if (deal?.id && referralThreadTs) {
      try {
        await updateHubSpotDealSlackThread(deal.id, referralThreadTs);
      } catch (err) {
        console.error(
          "❌ HubSpot referral slack thread update error:",
          err?.response?.status,
          err?.response?.data || err
        );
      }
    }
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
    const keeperCompanyId =
      values.keeper_company?.double_client_search?.selected_option?.value || "";
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

    let hubspotUpdate = { created: false, reason: "missing_company_id" };
    if (hubspotCompanyId) {
      try {
        hubspotUpdate = await createClientLossDealForCompany(hubspotCompanyId, {
          dealTypeLabel: "Client Loss",
        });
      } catch (err) {
        console.error(
          "❌ HubSpot client loss deal create error:",
          err?.response?.status,
          err?.response?.data || err
        );
        hubspotUpdate = { created: false, reason: "error" };
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

    let doubleTemplateApply = { applied: false, reason: "missing_client_id" };
    if (keeperCompanyId) {
      try {
        // Template id provided by you: "Client Offboarding Template"
        doubleTemplateApply = await applyDoubleTaskTemplateToClient(
          171526,
          keeperCompanyId
        );
      } catch (err) {
        console.error(
          "❌ Double apply task template error:",
          err?.response?.status,
          err?.response?.data || err
        );
        doubleTemplateApply = { applied: false, reason: "error" };
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
    const dealLink =
      HUBSPOT_PORTAL_ID && hubspotUpdate?.dealId
        ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${hubspotUpdate.dealId}`
        : "";
    const companyLink =
      HUBSPOT_PORTAL_ID && hubspotCompanyId
        ? `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/company/${hubspotCompanyId}`
        : "";
    const headerLink = dealLink || companyLink;
    const headerText = `${requesterMention} 👋 Your client loss request was submitted. Updates will be posted as a thread in this message.${
      headerLink ? ` <${headerLink}|View in HubSpot>` : ""
    }`;
    const detailText = `*Requested by:* ${requesterName}  *Company Name:* ${hubspotCompany}  *Deal Type:* ${dealType}`;
    const notesText = `*Notes:* ${notes}`;
    const hubspotDealText = hubspotUpdate.created
      ? `deal created (${hubspotUpdate.dealId || "deal"})`
      : `deal not created (${hubspotUpdate.reason})`;
    const hubspotTypeText =
      hubspotUpdate?.dealTypeUpdate?.updated
        ? "deal type set"
        : hubspotUpdate?.dealTypeUpdate?.reason
          ? `deal type skipped (${hubspotUpdate.dealTypeUpdate.reason})`
          : "deal type skipped";
    const hubspotStageText =
      hubspotUpdate?.stageUpdate?.updated
        ? "stage set (Closed Won)"
        : hubspotUpdate?.stageUpdate?.reason
          ? `stage skipped (${hubspotUpdate.stageUpdate.reason})`
          : "stage skipped";
    const doubleText = doubleTemplateApply.applied
      ? "template applied"
      : `template skipped (${doubleTemplateApply.reason})`;
    const statusText = `*HubSpot:* ${hubspotDealText}, ${hubspotTypeText}, ${hubspotStageText}  *Airtable update:* ${
      airtableUpdate.updated ? "updated" : `skipped (${airtableUpdate.reason})`
    }  *Double:* ${doubleText}`;

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
        ...(headerLink
          ? [
              {
                type: "section",
                text: { type: "mrkdwn", text: `<${headerLink}|View in HubSpot>` },
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
