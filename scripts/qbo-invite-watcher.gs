// ============================================================
// Configuration
// ============================================================
var BASE_URL = "https://ignitespot-production.up.railway.app";
var SUPPORT_WEBHOOK_URL = BASE_URL + "/webhooks/support-ticket";
var SUPPORT_WEBHOOK_SECRET = "uyfnskvoigwklfpqlsnvpiouanpingiscool";
var SUPPORT_SLACK_CHANNEL_ID = "C05BY7CNQ1M";

var QBO_WEBHOOK_URL = BASE_URL + "/webhooks/qbo-invite";
var QBO_WEBHOOK_SECRET = "qbo-inv-x7k9mR4pW2vL8nT3";
var QBO_GMAIL_QUERY = 'subject:"has invited you to use QuickBooks Accountant" is:unread';

var QBO_LOG_SPREADSHEET_ID = "1iy-H4CQCcmJmU7EZQOvZhsdloNv07MZTfP5fRIXqB6c";
var QBO_LOG_SHEET_NAME = "Logs";

// ============================================================
// Single trigger — set this as your 5-minute trigger
// ============================================================
function runAll() {
  SendsWebhookToSlackBot();
  watchQboInvites();
}

// ============================================================
// Support Ticket Webhook (existing)
// ============================================================
function SendsWebhookToSlackBot() {
  var spreadsheet = SpreadsheetApp.getActive();
  var openSheet = spreadsheet.getSheetByName("Support_Tickets_OPEN");
  var closedSheet = spreadsheet.getSheetByName("Support_Tickets_CLOSED");
  if (!openSheet || !closedSheet) return;

  var data = openSheet.getDataRange().getValues();
  if (data.length < 2) return;

  var headers = data[0];
  function idx(name) {
    return headers.indexOf(name);
  }

  var colRequestDate = idx("Request Date");
  var colRequestId = idx("Request ID");
  var colRequester = idx("Requester");
  var colCompany = idx("Company Name");
  var colType = idx("Type");
  var colPriority = idx("Priority");
  var colThreadTs = idx("ID_message_sent_to_requester");
  var colApps = idx("Apps");
  var colNotes = idx("Notes");
  var colStatus = idx("Status");
  var colInProgressDate = idx("In Progress Date");
  var colCompletionDate = idx("Completion Date");
  var colSlackSent = idx("Slack message sent?");
  var colSlackLink = idx("Go to Slack Message");

  if (colStatus === -1 || colThreadTs === -1 || colSlackSent === -1) {
    throw new Error("Missing required headers.");
  }

  function sendStatus(rowIndex, status) {
    var spreadsheetId = spreadsheet.getId();
    var spreadsheetName = spreadsheet.getName();
    var start = spreadsheetName.toString().search(/\(/);
    var end = spreadsheetName.toString().search(/\)/);
    var customerName = spreadsheetName.substring(start + 1, end);

    var threadTs = openSheet.getRange(rowIndex + 1, colThreadTs + 1).getValue();
    var requester = openSheet.getRange(rowIndex + 1, colRequester + 1).getValue();

    var payload = {
      spreadsheetId: spreadsheetId,
      spreadsheetName: spreadsheetName,
      customerName: customerName,
      type: "support_ticket_status",
      thread_ts: threadTs,
      ticket_status: status,
      requester: requester,
      channel_id: SUPPORT_SLACK_CHANNEL_ID,
    };

    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      headers: SUPPORT_WEBHOOK_SECRET
        ? { "x-webhook-secret": SUPPORT_WEBHOOK_SECRET }
        : {},
      muteHttpExceptions: true,
    };

    UrlFetchApp.fetch(SUPPORT_WEBHOOK_URL, options);
  }

  for (var i = 1; i < data.length; i++) {
    var status = data[i][colStatus];
    var slackSent = data[i][colSlackSent];

    if (status === "In Progress" && slackSent !== "In Progress Status message") {
      sendStatus(i, "In Progress");
      if (colInProgressDate > -1 && !data[i][colInProgressDate]) {
        openSheet.getRange(i + 1, colInProgressDate + 1).setValue(new Date());
      }
      openSheet.getRange(i + 1, colSlackSent + 1).setValue(
        "In Progress Status message"
      );
    }

    if (status === "Completed" && slackSent !== "Completed Status message") {
      sendStatus(i, "Completed");
      if (colCompletionDate > -1 && !data[i][colCompletionDate]) {
        openSheet.getRange(i + 1, colCompletionDate + 1).setValue(new Date());
      }
      openSheet.getRange(i + 1, colSlackSent + 1).setValue(
        "Completed Status message"
      );
    }
  }

  data = openSheet.getDataRange().getValues();
  for (var r = data.length - 1; r > 0; r--) {
    if (data[r][colSlackSent] === "Completed Status message") {
      openSheet
        .getRange(r + 1, 1, 1, headers.length)
        .copyTo(
          closedSheet.getRange(closedSheet.getLastRow() + 1, 1),
          SpreadsheetApp.CopyPasteType.PASTE_NORMAL,
          false
        );
      openSheet.deleteRow(r + 1);
    }
  }
}

// ============================================================
// QBO Logging
// ============================================================
function qboLog(event, companyName, status, details) {
  try {
    var ss = SpreadsheetApp.openById(QBO_LOG_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(QBO_LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(QBO_LOG_SHEET_NAME);
      sheet.appendRow(["Timestamp", "Event", "Company", "Status", "Details"]);
    }
    sheet.appendRow([
      new Date(),
      event || "",
      companyName || "",
      status || "",
      details || "",
    ]);
  } catch (err) {
    Logger.log("Log write error: " + err.message);
  }
}

// ============================================================
// QBO Invite Watcher
// ============================================================
function watchQboInvites() {
  var threads = GmailApp.search(QBO_GMAIL_QUERY, 0, 10);

  if (!threads.length) {
    Logger.log("No new QBO invite emails found.");
    return;
  }

  qboLog("Search", "", "Found", threads.length + " thread(s)");

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();

    for (var j = 0; j < messages.length; j++) {
      var message = messages[j];
      if (!message.isUnread()) continue;

      try {
        var parsed = parseQboInviteEmail(message);
        if (!parsed) {
          qboLog("Parse", "", "Skipped", "Could not parse: " + message.getSubject());
          message.markRead();
          continue;
        }
        qboLog("Parse", parsed.companyName, "OK", "sender=" + parsed.senderName + " email=" + parsed.senderEmail + " link=" + (parsed.inviteLink ? "yes" : "no"));

        var success = postQboWebhook(parsed);
        if (success) {
          message.markRead();
          qboLog("Webhook", parsed.companyName, "Sent", "Marked as read");
        } else {
          qboLog("Webhook", parsed.companyName, "Failed", "Webhook returned error");
        }
      } catch (err) {
        qboLog("Error", "", "Error", err.message);
        Logger.log("Error processing QBO invite: " + err.message);
      }
    }
  }
}

function parseQboInviteEmail(message) {
  var subject = message.getSubject() || "";
  var body = message.getBody() || "";
  var plainBody = message.getPlainBody() || "";

  // Extract company name from subject
  var companyName = "";
  var subjectMatch = subject.match(/\]\s*(.+?)\s+has invited you/i);
  if (subjectMatch) {
    companyName = subjectMatch[1].trim();
  }

  if (!companyName) {
    Logger.log("Could not extract company name from subject: " + subject);
    return null;
  }

  // Extract sender email from HTML body (mailto link or inline email)
  var senderEmail = "";
  var emailFromHref = body.match(/href=["']mailto:([^"']+)["']/i);
  if (emailFromHref) {
    senderEmail = emailFromHref[1].trim();
  }

  if (!senderEmail) {
    var emailFromBody = plainBody.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\s+has invited you/i);
    if (emailFromBody) {
      senderEmail = emailFromBody[1].trim();
    }
  }

  if (!senderEmail) {
    var anyEmail = body.match(/([a-zA-Z0-9._%+\-]+@(?!intuit|quickbooks)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
    if (anyEmail) {
      senderEmail = anyEmail[1].trim();
    }
  }

  // Extract sender name from body
  var senderName = "";
  var senderMatch = plainBody.match(/^(.+?)\s+has invited you/m);
  if (senderMatch) {
    senderName = senderMatch[1].trim();
    // If sender name is just an email, clean it up
    if (senderName.indexOf("@") > -1) {
      senderName = senderName.split("@")[0].replace(/[._]/g, " ");
      senderName = senderName.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    }
  }

  // Extract invite link from HTML body
  var inviteLink = "";
  var linkMatch = body.match(
    /href=["'](https?:\/\/[^"']*(?:accept|invite)[^"']*)["']/i
  );
  if (linkMatch) {
    inviteLink = linkMatch[1];
  }

  if (!inviteLink) {
    linkMatch = body.match(
      /href=["'](https?:\/\/qbo\.intuit\.com[^"']*)["']/i
    );
    if (linkMatch) {
      inviteLink = linkMatch[1];
    }
  }

  if (!inviteLink) {
    linkMatch = body.match(
      /href=["'](https?:\/\/[^"']*intuit\.com[^"']*(?:accept|invite|connect)[^"']*)["']/i
    );
    if (linkMatch) {
      inviteLink = linkMatch[1];
    }
  }

  // Intuit email tracking links (elink.prd.intuit.com)
  if (!inviteLink) {
    linkMatch = body.match(
      /href=["'](https?:\/\/elink\.prd\.intuit\.com[^"']*)["']/i
    );
    if (linkMatch) {
      inviteLink = linkMatch[1];
    }
  }

  // Build body text
  var bodyText = "";
  var bodyTextMatch = plainBody.match(/(.+has invited you.+?\.)/);
  if (bodyTextMatch) {
    bodyText = bodyTextMatch[1].trim();
  }

  return {
    companyName: companyName,
    senderName: senderName,
    senderEmail: senderEmail,
    inviteLink: inviteLink,
    inviteType: "qbo",
    bodyText: bodyText,
  };
}

function postQboWebhook(data) {
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(data),
    headers: {},
    muteHttpExceptions: true,
  };

  if (QBO_WEBHOOK_SECRET) {
    options.headers["x-webhook-secret"] = QBO_WEBHOOK_SECRET;
  }

  var response = UrlFetchApp.fetch(QBO_WEBHOOK_URL, options);
  var code = response.getResponseCode();

  if (code === 200) {
    Logger.log("QBO webhook success: " + response.getContentText());
    return true;
  } else {
    Logger.log("QBO webhook error (" + code + "): " + response.getContentText());
    return false;
  }
}
