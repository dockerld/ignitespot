import { AIRTABLE_CLIENT_SOFTWARE_TABLE_ID, HUBSPOT_WEBHOOK_SECRET } from "../env.js";
import {
  getHubSpotCompanyById,
  getHubSpotContactById,
  getHubSpotPrimaryContactIdForDeal,
} from "../integrations/hubspot.js";
import {
  createAirtableRecord,
  findAirtableRecordByField,
  updateAirtableRecordFields,
} from "../integrations/airtable.js";
import { ensureCompanyFolder } from "../integrations/googleDrive.js";

const COMPANY_PROPERTIES = ["name", "domain", "phone", "address", "city", "state", "zip"];
const CONTACT_PROPERTIES = ["firstname", "lastname", "email", "phone", "mobilephone"];
const CLIENT_SOFTWARE_CONTACT_FIELD = "Contact";
const CLIENT_SOFTWARE_DEAL_ID_FIELD = "HubSpot Deal ID";
const CLIENT_SOFTWARE_GROUP_NAME_FIELD = "Group Name";

function logAirtableError(err, context, fields) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  if (!status) return;
  console.error(`❌ Airtable ${context} error:`, status, data || err?.message || err);
  if (fields && typeof fields === "object") {
    const summary = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        Array.isArray(value) ? `array(${value.length})` : typeof value,
      ])
    );
    console.error("↳ Airtable payload summary:", {
      fields: summary,
      hubspotDealId: fields[CLIENT_SOFTWARE_DEAL_ID_FIELD] ?? fields["HubSpot Deal ID"],
    });
  }
}

function getDealProperty(payload, name) {
  const entry = payload?.properties?.[name];
  if (!entry) return "";
  if (typeof entry === "object" && entry !== null && "value" in entry) {
    return entry.value;
  }
  return entry;
}

function parseNumberValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseMultiSelectValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.filter(Boolean);
  const raw = String(value);
  const parts = raw.includes(";") || raw.includes(",") ? raw.split(/[;,]/) : [raw];
  const cleaned = parts.map((part) => part.trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

function setField(fields, name, value) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.trim() === "") return;
  fields[name] = value;
}

function buildAirtableFields({ payload, dealId, company, contact, clientSoftwareId }) {
  const companyProps = company?.properties || {};
  const contactProps = contact?.properties || {};
  const contactName = [contactProps.firstname, contactProps.lastname]
    .filter(Boolean)
    .join(" ")
    .trim();
  const dealAmount = parseNumberValue(getDealProperty(payload, "amount"));
  const physicalAddress =
    getDealProperty(payload, "street_address") || companyProps.address;

  const fields = {};
  setField(fields, "Group Name", companyProps.name);
  setField(fields, "Sub Name", companyProps.name);
  setField(fields, "Company Name", companyProps.name);
  setField(fields, "HubSpot Contact", contactName);
  setField(fields, "Main Contact", contactName);
  setField(fields, "Email", contactProps.email);
  setField(fields, "Main Contact Phone", contactProps.mobilephone);
  setField(fields, "Physical Address (if different from billing)", physicalAddress);
  if (clientSoftwareId) {
    setField(fields, "Client Software List", [clientSoftwareId]);
  }
  if (dealAmount !== null) {
    setField(fields, "Recurring Billing", dealAmount);
  }
  if (dealId !== null && dealId !== undefined) {
    setField(fields, "HubSpot Deal ID", String(dealId));
  }
  setField(fields, "HubSpot Company ID", company?.id);

  return fields;
}

function buildClientSoftwareFields({ payload, dealId, company }) {
  const companyProps = company?.properties || {};
  const servicesPurchased = getDealProperty(payload, "services_purchased");
  const cfoFrequency = getDealProperty(payload, "cfo_frequency");
  const controllerFrequency = getDealProperty(payload, "controller_frequency");
  const accountingFrequency = getDealProperty(payload, "accounting_frequency");
  const payrollProvider = getDealProperty(payload, "payroll_provider");

  const fields = {};
  setField(fields, CLIENT_SOFTWARE_GROUP_NAME_FIELD, companyProps.name);
  setField(fields, "Close Out", "Onboarding");

  const servicesValues = parseMultiSelectValue(servicesPurchased);
  if (servicesValues) {
    setField(fields, "Services", servicesValues);
  }

  setField(fields, "CFO Frequency", cfoFrequency);
  setField(fields, "Controller Frequency", controllerFrequency);
  setField(fields, "Accounting Frequency", accountingFrequency);

  const payrollValues = parseMultiSelectValue(payrollProvider);
  if (payrollValues) {
    setField(fields, "Payroll Software", payrollValues);
  }

  if (dealId !== null && dealId !== undefined) {
    setField(fields, CLIENT_SOFTWARE_DEAL_ID_FIELD, String(dealId));
  }
  return fields;
}

function buildClientSoftwareUpdateFields(payload) {
  const accountant = getDealProperty(payload, "accountant");
  const controller = getDealProperty(payload, "controller");
  const cfo = getDealProperty(payload, "cfo");

  const fields = {};
  setField(fields, "Accountant", accountant);
  setField(fields, "Controller", controller);
  setField(fields, "CFO", cfo);
  return fields;
}

function getHeader(headers, name) {
  if (!headers) return "";
  const key = Object.keys(headers).find(
    (header) => header.toLowerCase() === name.toLowerCase()
  );
  return key ? headers[key] : "";
}

function verifyWebhookSecret(headers) {
  if (!HUBSPOT_WEBHOOK_SECRET) return true;

  const hubspotHeader = getHeader(headers, "hubspot_webhook_secret");
  const direct = getHeader(headers, "x-webhook-secret");
  const auth = getHeader(headers, "authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";

  return (
    hubspotHeader === HUBSPOT_WEBHOOK_SECRET ||
    direct === HUBSPOT_WEBHOOK_SECRET ||
    token === HUBSPOT_WEBHOOK_SECRET
  );
}

export async function handleHubSpotWebhook(payload, headers = {}, options = {}) {
  const updateOnly = options?.updateOnly === true;
  if (!verifyWebhookSecret(headers)) {
    const err = new Error("Unauthorized HubSpot webhook.");
    err.statusCode = 401;
    throw err;
  }

  const dealId = payload?.objectId || payload?.properties?.hs_object_id?.value;
  const companyId = payload?.properties?.hs_primary_associated_company?.value;
  console.log("📨 HubSpot webhook:", {
    dealId,
    companyId,
    propertyCount: Object.keys(payload?.properties || {}).length,
  });

  let company = null;
  let primaryContactId = null;
  let contact = null;
  let driveFolder = null;

  if (companyId) {
    company = await getHubSpotCompanyById(companyId, COMPANY_PROPERTIES);
  }

  if (dealId) {
    primaryContactId = await getHubSpotPrimaryContactIdForDeal(dealId);
  }

  if (primaryContactId) {
    contact = await getHubSpotContactById(primaryContactId, CONTACT_PROPERTIES);
  }

  if (!updateOnly && company?.properties?.name) {
    try {
      driveFolder = await ensureCompanyFolder(company.properties.name);
      if (driveFolder) {
        console.log(
          `📁 Google Drive folder ${driveFolder.created ? "created" : "found"}:`,
          { id: driveFolder.id, name: driveFolder.name, link: driveFolder.webViewLink }
        );
      }
    } catch (err) {
      console.error(
        "❌ Google Drive folder error:",
        err?.response?.data || err?.message || err
      );
    }
  }

  const resolved = {
    dealId,
    companyId,
    primaryContactId,
    company: company
      ? { id: company.id, properties: company.properties || {} }
      : null,
    contact: contact
      ? { id: contact.id, properties: contact.properties || {} }
      : null,
    driveFolder: driveFolder
      ? { id: driveFolder.id, webViewLink: driveFolder.webViewLink }
      : null,
  };

  console.log("🏢 HubSpot company resolved:", resolved.company || "none");
  console.log("👤 HubSpot primary contact resolved:", resolved.contact || "none");

  let clientSoftwareId = null;
  let clientSoftwareRecord = null;
  let clientSoftwareExisting = null;
  let clientSoftwareFields = null;
  if (AIRTABLE_CLIENT_SOFTWARE_TABLE_ID && dealId) {
    try {
      clientSoftwareFields = updateOnly
        ? buildClientSoftwareUpdateFields(payload)
        : buildClientSoftwareFields({
            payload,
            dealId,
            company: resolved.company,
          });
      clientSoftwareExisting = await findAirtableRecordByField(
        CLIENT_SOFTWARE_DEAL_ID_FIELD,
        dealId,
        AIRTABLE_CLIENT_SOFTWARE_TABLE_ID
      );
      if (clientSoftwareExisting?.id) {
        if (clientSoftwareFields && Object.keys(clientSoftwareFields).length) {
          clientSoftwareRecord = await updateAirtableRecordFields(
            clientSoftwareExisting.id,
            clientSoftwareFields,
            AIRTABLE_CLIENT_SOFTWARE_TABLE_ID
          );
          clientSoftwareId = clientSoftwareExisting.id;
        } else {
          resolved.clientSoftware = { action: "skipped", reason: "no_fields" };
        }
      } else if (!updateOnly) {
        clientSoftwareRecord = await createAirtableRecord(
          clientSoftwareFields,
          AIRTABLE_CLIENT_SOFTWARE_TABLE_ID
        );
        clientSoftwareId = clientSoftwareRecord?.id || null;
      } else {
        resolved.clientSoftware = { action: "skipped", reason: "not_found" };
      }
    } catch (err) {
      logAirtableError(err, "Client Software List", clientSoftwareFields);
      throw err;
    }
  }

  let mainRecordId = null;
  if (!updateOnly) {
    const airtableFields = buildAirtableFields({
      payload,
      dealId,
      company: resolved.company,
      contact: resolved.contact,
      clientSoftwareId,
    });
    let airtableRecord = null;
    try {
      if (dealId) {
        const existing = await findAirtableRecordByField("HubSpot Deal ID", dealId);
        if (existing?.id) {
          airtableRecord = await updateAirtableRecordFields(
            existing.id,
            airtableFields
          );
          mainRecordId = existing.id;
          resolved.airtable = { id: existing.id, action: "updated" };
        }
      }
      if (!resolved.airtable) {
        airtableRecord = await createAirtableRecord(airtableFields);
        mainRecordId = airtableRecord?.id || null;
        resolved.airtable = airtableRecord?.id
          ? { id: airtableRecord.id, action: "created" }
          : null;
      }
    } catch (err) {
      logAirtableError(err, "Main table", airtableFields);
      throw err;
    }
    console.log("📗 Airtable record synced:", resolved.airtable || "none");
  } else {
    resolved.airtable = { action: "skipped", reason: "update_only" };
  }

  if (!updateOnly && clientSoftwareId && mainRecordId) {
    try {
      const existingLinks = Array.isArray(
        clientSoftwareExisting?.fields?.[CLIENT_SOFTWARE_CONTACT_FIELD]
      )
        ? clientSoftwareExisting.fields[CLIENT_SOFTWARE_CONTACT_FIELD]
        : [];
      if (!existingLinks.includes(mainRecordId)) {
        const nextLinks = Array.from(new Set([...existingLinks, mainRecordId]));
        await updateAirtableRecordFields(
          clientSoftwareId,
          { [CLIENT_SOFTWARE_CONTACT_FIELD]: nextLinks },
          AIRTABLE_CLIENT_SOFTWARE_TABLE_ID
        );
      }
    } catch (err) {
      logAirtableError(err, "Client Software link", {
        [CLIENT_SOFTWARE_CONTACT_FIELD]: [mainRecordId],
      });
      throw err;
    }
  }

  return { received: true, resolved };
}
