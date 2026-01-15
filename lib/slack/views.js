export function toolPickerView(userId) {
  const mention = userId ? `<@${userId}>` : "there";

  return {
    type: "modal",
    callback_id: "tool_picker",
    title: { type: "plain_text", text: "IgniteSpot Bot" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Ignite Spot Slack Bot" },
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
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "I need to update *client systems* (HubSpot, Double, Airtable)",
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Click Me" },
          action_id: "update_client",
        },
      },
    ],
  };
}

export function pageInProgressView(title) {
  return {
    type: "modal",
    callback_id: "page_in_progress",
    title: { type: "plain_text", text: title },
    submit: { type: "plain_text", text: "Back" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Page in progress :)" },
      },
    ],
  };
}

export function updateClientView() {
  return {
    type: "modal",
    callback_id: "update_client_submit",
    title: { type: "plain_text", text: "Update Clients" },
    submit: { type: "plain_text", text: "Update Clients" },
    close: { type: "plain_text", text: "Back" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "Select a HubSpot company, Double client, and Airtable record. This will update all three.",
        },
      },
      {
        type: "input",
        block_id: "company",
        label: { type: "plain_text", text: "Search for company" },
        element: {
          type: "external_select",
          action_id: "company_search",
          placeholder: { type: "plain_text", text: "Type at least 3 letters..." },
          min_query_length: 3,
        },
      },
      {
        type: "input",
        block_id: "double_client",
        label: { type: "plain_text", text: "Search Double client" },
        element: {
          type: "external_select",
          action_id: "double_client_search",
          placeholder: { type: "plain_text", text: "Type at least 3 letters..." },
          min_query_length: 3,
        },
      },
      {
        type: "input",
        block_id: "airtable_record",
        label: { type: "plain_text", text: "Search Airtable record" },
        element: {
          type: "external_select",
          action_id: "airtable_record_search",
          placeholder: { type: "plain_text", text: "Type at least 3 letters..." },
          min_query_length: 3,
        },
      },
    ],
  };
}
