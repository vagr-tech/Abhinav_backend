// zohoCacheJob.js
// Run this at midnight via node-cron
// npm install node-cron

const cron = require("node-cron");
const { getAccessToken } = require("./services/zohoService");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const ddb = require("./config/dynamo");
const axios = require("axios");

const CACHE_TABLE = "abhinav_zoho_cache"; // separate table or same table with different pk

// ─── Fetch ALL contacts from Zoho ─────────────────────────
const fetchAllZohoContacts = async (accessToken) => {
  let page = 1;
  let allContacts = [];

  while (true) {
    const res = await axios.get("https://www.zohoapis.in/books/v3/contacts", {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      params: {
        organization_id: process.env.ZOHO_ORG_ID,
        page,
        per_page: 200,
      },
    });

    const contacts = res.data.contacts || [];
    allContacts.push(...contacts);

    // Zoho pagination: if less than per_page returned, we're done
    if (contacts.length < 200) break;
    page++;
  }

  return allContacts;
};

// ─── Fetch invoices for one contact ───────────────────────
const fetchInvoicesForContact = async (contactId, accessToken) => {
  const res = await axios.get("https://www.zohoapis.in/books/v3/invoices", {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    params: {
      organization_id: process.env.ZOHO_ORG_ID,
      customer_id: contactId,
    },
  });

  return res.data.invoices || [];
};

// ─── Main cache builder ────────────────────────────────────
const buildZohoCache = async () => {
  console.log("🕛 Starting Zoho cache build...");

  try {
    const accessToken = await getAccessToken();

    // Step 1: Get all DB shops (to know which GSTs to cache)
    let shops = [];
    let lastKey;

    do {
      const result = await ddb.send(
        new ScanCommand({
          TableName: "abhinav_shops",
          FilterExpression:
            "sk = :profile AND (attribute_not_exists(isDeleted) OR isDeleted = :false)",
          ExpressionAttributeValues: {
            ":profile": "PROFILE",
            ":false": false,
          },
          ExclusiveStartKey: lastKey,
        }),
      );
      shops.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    console.log(`📦 Found ${shops.length} shops in DB`);

    // Step 2: Get all Zoho contacts once
    const allContacts = await fetchAllZohoContacts(accessToken);
    console.log(`📋 Fetched ${allContacts.length} contacts from Zoho`);

    // Build a map: gst_no → contact
    const gstMap = {};
    const nameMap = {};
    for (const c of allContacts) {
      if (c.gst_no) gstMap[c.gst_no.toUpperCase()] = c;
      if (c.contact_name) nameMap[c.contact_name.toLowerCase()] = c;
    }

    // Step 3: For each shop, match + fetch invoices + save to cache
    let saved = 0;
    let unmatched = 0;

    // TTL = next midnight (seconds)
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    const ttl = Math.floor(tomorrow.getTime() / 1000);

    for (const shop of shops) {
      const gstNumber = (shop.gstNumber || shop.gst_number || "").toUpperCase();
      const shopName = (shop.shop_name || "").toLowerCase();

      // Match by GST first, then name
      const contact =
        (gstNumber && gstMap[gstNumber]) ||
        (shopName && nameMap[shopName]) ||
        null;

      if (!contact) {
        unmatched++;
        // Save unmatched record so API knows quickly
        await ddb.send(
          new PutCommand({
            TableName: CACHE_TABLE,
            Item: {
              pk: `ZOHO_CACHE#${gstNumber || shop.shop_id}`,
              sk: "DATA",
              shop_id: shop.shop_id,
              shop_name: shop.shop_name,
              matched: false,
              cached_at: new Date().toISOString(),
              ttl,
            },
          }),
        );
        continue;
      }

      // Fetch invoices for matched contact
      const invoices = await fetchInvoicesForContact(
        contact.contact_id,
        accessToken,
      );

      const totalBilled = invoices.reduce(
        (sum, inv) => sum + (inv.total || 0),
        0,
      );
      const outstanding = invoices.reduce(
        (sum, inv) => sum + (inv.balance || 0),
        0,
      );

      const cacheKey = gstNumber || shop.shop_id;

      await ddb.send(
        new PutCommand({
          TableName: CACHE_TABLE,
          Item: {
            pk: `ZOHO_CACHE#${cacheKey}`,
            sk: "DATA",
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            matched: true,
            match_type: gstNumber && contact.gst_no ? "gst" : "name",
            zoho_name: contact.contact_name,
            zoho_gst: contact.gst_no || null,
            total_billed: totalBilled,
            outstanding,
            invoice_count: invoices.length,
            invoices: invoices.slice(0, 50).map((inv) => ({
              invoice_number: inv.invoice_number,
              date: inv.date,
              total: inv.total,
              balance: inv.balance,
              status: inv.status,
            })),
            cached_at: new Date().toISOString(),
            ttl, // DynamoDB TTL — auto-delete next day
          },
        }),
      );

      saved++;
    }

    console.log(
      `✅ Cache built: ${saved} matched, ${unmatched} unmatched, TTL: ${new Date(ttl * 1000).toISOString()}`,
    );
  } catch (err) {
    console.error("❌ Cache build failed:", err.message);
  }
};

// ─── Cron: run at 12:00 AM every day ──────────────────────
cron.schedule("0 0 * * *", () => {
  buildZohoCache();
});

// ─── Also export for manual trigger ───────────────────────
module.exports = { buildZohoCache };
