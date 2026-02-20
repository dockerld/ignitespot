export function toolPickerView(userId) {
  const mention = userId ? `<@${userId}>` : "there";

  return {
    type: "modal",
    callback_id: "tool_picker",
    title: { type: "plain_text", text: "Ignite BlazeBot" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Ignite BlazeBot" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Hey ${mention}, glad to help you!\nPlease select the option that matches your need.`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "I need to request a *proposal change*",
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Click Me" },
          action_id: "proposal_change",
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "I need to submit a *new customer*" },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Click Me" },
          action_id: "new_customer",
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "I need to create a *support ticket*" },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Click Me" },
          action_id: "support_ticket",
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "I need to submit a *client referral*" },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Click Me" },
          action_id: "client_referral",
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "I need to submit a *client loss*" },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Click Me" },
          action_id: "client_loss",
        },
      },
    ],
  };
}

function backActionsBlock({ confirmBack = false } = {}) {
  const confirm = confirmBack
    ? {
        title: { type: "plain_text", text: "Discard changes?" },
        text: {
          type: "plain_text",
          text: "Going back will discard anything you've entered.",
        },
        confirm: { type: "plain_text", text: "Discard" },
        deny: { type: "plain_text", text: "Keep editing" },
      }
    : undefined;

  return {
    type: "section",
    text: { type: "mrkdwn", text: " " },
    accessory: {
      type: "button",
      action_id: "go_back",
      text: { type: "plain_text", text: "Back" },
      ...(confirm ? { confirm } : {}),
    },
  };
}

export function pageInProgressView(title) {
  return {
    type: "modal",
    callback_id: "page_in_progress",
    title: { type: "plain_text", text: title },
    submit: { type: "plain_text", text: "Back" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Page in progress :)" },
      },
    ],
  };
}

export function proposalChangeView({ confirmBack = false } = {}) {
  return {
    type: "modal",
    callback_id: "proposal_change_submit",
    title: { type: "plain_text", text: "Request proposal change" },
    submit: { type: "plain_text", text: "Request" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Request a proposal change" },
      },
      {
        type: "input",
        block_id: "company",
        label: { type: "plain_text", text: "Company Name" },
        element: {
          type: "external_select",
          action_id: "company_search",
          placeholder: { type: "plain_text", text: "Select an item" },
          min_query_length: 3,
        },
      },
      {
        type: "input",
        block_id: "deal_type",
        label: { type: "plain_text", text: "Deal Type" },
        element: {
          type: "external_select",
          action_id: "deal_type_search",
          placeholder: { type: "plain_text", text: "Select an item" },
          min_query_length: 0,
        },
      },
      {
        type: "input",
        block_id: "proposal_email",
        label: { type: "plain_text", text: "Email Address for sending proposal" },
        element: {
          type: "plain_text_input",
          action_id: "proposal_email_input",
          placeholder: { type: "plain_text", text: "📧 Enter an email", emoji: true },
        },
      },
      {
        type: "input",
        block_id: "proposal_notes",
        optional: true,
        label: { type: "plain_text", text: "Notes" },
        element: {
          type: "plain_text_input",
          action_id: "proposal_notes_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "Add some details" },
        },
      },
      backActionsBlock({ confirmBack }),
    ],
  };
}

export function newCustomerView({ confirmBack = false } = {}) {
  return {
    type: "modal",
    callback_id: "new_customer_submit",
    title: { type: "plain_text", text: "New customer details" },
    submit: { type: "plain_text", text: "Request" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New customer details" },
      },
      {
        type: "input",
        block_id: "customer_company_name",
        label: { type: "plain_text", text: "Company Name" },
        element: {
          type: "plain_text_input",
          action_id: "customer_company_name_input",
          placeholder: { type: "plain_text", text: "Write something" },
        },
      },
      {
        type: "input",
        block_id: "customer_first_name",
        label: { type: "plain_text", text: "Client First Name" },
        element: {
          type: "plain_text_input",
          action_id: "customer_first_name_input",
          placeholder: { type: "plain_text", text: "Write something" },
        },
      },
      {
        type: "input",
        block_id: "customer_last_name",
        label: { type: "plain_text", text: "Client Last Name" },
        element: {
          type: "plain_text_input",
          action_id: "customer_last_name_input",
          placeholder: { type: "plain_text", text: "Write something" },
        },
      },
      {
        type: "input",
        block_id: "customer_email",
        label: { type: "plain_text", text: "Client Email" },
        element: {
          type: "plain_text_input",
          action_id: "customer_email_input",
          placeholder: { type: "plain_text", text: "Write something" },
        },
      },
      {
        type: "input",
        block_id: "hear_about_us",
        label: { type: "plain_text", text: "How did you hear about us?" },
        element: {
          type: "external_select",
          action_id: "hear_about_us_search",
          placeholder: { type: "plain_text", text: "Select an item" },
          min_query_length: 0,
        },
      },
      {
        type: "input",
        block_id: "customer_notes",
        optional: true,
        label: { type: "plain_text", text: "Notes" },
        element: {
          type: "plain_text_input",
          action_id: "customer_notes_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "Add some details" },
        },
      },
      backActionsBlock({ confirmBack }),
    ],
  };
}

export function clientReferralView({ confirmBack = false } = {}) {
  return {
    type: "modal",
    callback_id: "client_referral_submit",
    title: { type: "plain_text", text: "New client referral" },
    submit: { type: "plain_text", text: "Request" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New client referral" },
      },
      {
        type: "input",
        block_id: "referral_company_name",
        label: { type: "plain_text", text: "Company Name" },
        element: {
          type: "plain_text_input",
          action_id: "referral_company_name_input",
          placeholder: { type: "plain_text", text: "Write something" },
        },
      },
      {
        type: "input",
        block_id: "referral_first_name",
        label: { type: "plain_text", text: "Client First Name" },
        element: {
          type: "plain_text_input",
          action_id: "referral_first_name_input",
          placeholder: { type: "plain_text", text: "Write something" },
        },
      },
      {
        type: "input",
        block_id: "referral_last_name",
        label: { type: "plain_text", text: "Client Last Name" },
        element: {
          type: "plain_text_input",
          action_id: "referral_last_name_input",
          placeholder: { type: "plain_text", text: "Write something" },
        },
      },
      {
        type: "input",
        block_id: "referral_email",
        label: { type: "plain_text", text: "Client Email" },
        element: {
          type: "plain_text_input",
          action_id: "referral_email_input",
          placeholder: { type: "plain_text", text: "Write something" },
        },
      },
      {
        type: "input",
        block_id: "referral_notes",
        optional: true,
        label: { type: "plain_text", text: "Notes" },
        element: {
          type: "plain_text_input",
          action_id: "referral_notes_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "Add some details" },
        },
      },
      backActionsBlock({ confirmBack }),
    ],
  };
}

export function clientLossChangeOrderView({ confirmBack = false } = {}) {
  return {
    type: "modal",
    callback_id: "client_loss_submit",
    title: { type: "plain_text", text: "Client loss change order" },
    submit: { type: "plain_text", text: "Request" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Change order details" },
      },
      {
        type: "input",
        block_id: "hubspot_company",
        label: { type: "plain_text", text: "HubSpot Company Name" },
        element: {
          type: "external_select",
          action_id: "company_search",
          placeholder: { type: "plain_text", text: "Select an item" },
          min_query_length: 3,
        },
      },
      {
        type: "input",
        block_id: "keeper_company",
        label: { type: "plain_text", text: "Double Company Name" },
        element: {
          type: "external_select",
          action_id: "double_client_search",
          placeholder: { type: "plain_text", text: "Select an item" },
          min_query_length: 3,
        },
      },
      {
        type: "input",
        block_id: "airtable_company",
        label: { type: "plain_text", text: "Airtable Company Name" },
        element: {
          type: "external_select",
          action_id: "airtable_record_search",
          placeholder: { type: "plain_text", text: "Select an item" },
          min_query_length: 3,
        },
      },
      {
        type: "input",
        block_id: "deal_type",
        label: { type: "plain_text", text: "Deal Type" },
        element: {
          type: "static_select",
          action_id: "deal_type_static",
          placeholder: { type: "plain_text", text: "Select an item" },
          options: [
            {
              text: { type: "plain_text", text: "Client Loss" },
              value: "client_loss",
            },
          ],
        },
      },
      {
        type: "input",
        block_id: "client_loss_notes",
        optional: true,
        label: { type: "plain_text", text: "Notes" },
        element: {
          type: "plain_text_input",
          action_id: "client_loss_notes_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "Add some details" },
        },
      },
      backActionsBlock({ confirmBack }),
    ],
  };
}

export function supportTicketView({ confirmBack = false } = {}) {
  const typeOptions = [
    "Login Issue",
    "New System/App",
    "Other",
  ].map((label) => ({
    text: { type: "plain_text", text: label },
    value: label.toLowerCase().replace(/\s+/g, "_"),
  }));

  const priorityOptions = ["Low", "Medium", "High"].map((label) => ({
    text: { type: "plain_text", text: label },
    value: label.toLowerCase(),
  }));

  const appOptions = [
    "1Password",
    "A2X",
    "ADP",
    "Bill",
    "Cashflow Tool",
    "Dext",
    "Divvy",
    "Fathom",
    "Google Drive",
    "Google Group",
    "Greenback",
    "Gusto",
    "Karbon",
    "Keeper",
    "LiveFlow",
    "Paychex",
    "QBO",
    "Relay",
    "Rewind",
    "Rippling",
    "SaaSant",
    "Shopify",
    "Slack",
  ].map((label) => ({
    text: { type: "plain_text", text: label },
    value: label.toLowerCase().replace(/\s+/g, "_"),
  }));

  return {
    type: "modal",
    callback_id: "support_ticket_submit",
    title: { type: "plain_text", text: "Support ticket details" },
    submit: { type: "plain_text", text: "Request" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Support ticket details" },
      },
      {
        type: "input",
        block_id: "support_company_manual",
        label: { type: "plain_text", text: "Company Name" },
        element: {
          type: "plain_text_input",
          action_id: "support_company_manual_input",
          placeholder: { type: "plain_text", text: "Type a company name" },
        },
      },
      {
        type: "input",
        block_id: "support_type",
        label: { type: "plain_text", text: "Type" },
        element: {
          type: "static_select",
          action_id: "support_type_select",
          placeholder: { type: "plain_text", text: "Select an item" },
          options: typeOptions,
        },
      },
      {
        type: "input",
        block_id: "support_priority",
        label: { type: "plain_text", text: "Priority" },
        element: {
          type: "static_select",
          action_id: "support_priority_select",
          placeholder: { type: "plain_text", text: "Select an item" },
          options: priorityOptions,
        },
      },
      {
        type: "input",
        block_id: "support_apps",
        optional: true,
        label: { type: "plain_text", text: "Apps" },
        element: {
          type: "multi_static_select",
          action_id: "support_apps_select",
          placeholder: { type: "plain_text", text: "Select items" },
          options: appOptions,
        },
      },
      {
        type: "input",
        block_id: "support_notes",
        optional: true,
        label: { type: "plain_text", text: "Notes" },
        element: {
          type: "plain_text_input",
          action_id: "support_notes_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "Add some details" },
        },
      },
      backActionsBlock({ confirmBack }),
    ],
  };
}
