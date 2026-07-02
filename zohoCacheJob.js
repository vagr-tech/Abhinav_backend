// zohoCacheJob.js

require("dotenv").config();

const cron = require("node-cron");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const axios = require("axios");

const client = new DynamoDBClient({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const ddb = DynamoDBDocumentClient.from(client);

const SHOP_TABLE = "abhinav_shops";
const CACHE_TABLE = "abhinav_zoho_cache";

// ─── Zoho Token ───────────────────────────────────────────
let cachedToken = null;
let tokenExpiresAt = null;

const getAccessToken = async () => {
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }
  const res = await axios.post(
    "https://accounts.zoho.in/oauth/v2/token",
    null,
    {
      params: {
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: "refresh_token",
      },
    },
  );
  if (res.data.error) throw new Error(`Zoho token error: ${res.data.error}`);
  cachedToken = res.data.access_token;
  tokenExpiresAt = Date.now() + (res.data.expires_in || 3600) * 1000;
  console.log("✅ Zoho token refreshed");
  return cachedToken;
};

// ─── Fetch ALL Zoho contacts (paginated) ──────────────────
const fetchAllZohoContacts = async (accessToken) => {
  let page = 1;
  let all = [];
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
    all.push(...contacts);
    if (contacts.length < 200) break;
    page++;
  }
  console.log(`📋 Zoho contacts fetched: ${all.length}`);
  return all;
};

// ─── Fetch invoices for one contact ───────────────────────
const fetchInvoices = async (contactId, accessToken) => {
  const res = await axios.get("https://www.zohoapis.in/books/v3/invoices", {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    params: {
      organization_id: process.env.ZOHO_ORG_ID,
      customer_id: contactId,
    },
  });
  return res.data.invoices || [];
};

// ─── Phone normalize helper ────────────────────────────────
const normalizePhone = (p) =>
  (p || "")
    .toString()
    .replace(/[\s\-]/g, "")
    .replace(/^(\+91|91|0)/, "");

// ─── Main Cache Builder ────────────────────────────────────
const buildZohoCache = async () => {
  console.log("===========================================");
  console.log("🕛 Starting Zoho cache build...");
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log("===========================================\n");

  try {
    // Step 1: Zoho contacts fetch (ALL contacts — gst and phone both needed)
    console.log("🔑 Getting Zoho access token...");
    const accessToken = await getAccessToken();

    console.log("📡 Fetching Zoho contacts...");
    const allContacts = await fetchAllZohoContacts(accessToken);

    if (allContacts.length === 0) {
      console.log("⚠️  No Zoho contacts fetched — nothing to cache");
      return;
    }

    // Step 2: DB shops — GST map + Phone map build
    console.log("\n📦 Fetching shops from DB...");
    let shops = [];
    let lastKey;
    do {
      const result = await ddb.send(
        new ScanCommand({
          TableName: SHOP_TABLE,
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

    // ✅ DB shops GST map
    const dbGstMap = {};
    for (const shop of shops) {
      const gst = (shop.gstNumber || shop.gst_number || "").toUpperCase();
      if (gst) dbGstMap[gst] = shop;
    }

    // ✅ DB shops Phone map
    const dbPhoneMap = {};
    for (const shop of shops) {
      const phone = normalizePhone(shop.primaryPhone || shop.secondaryPhone);
      if (phone) dbPhoneMap[phone] = shop;
    }

    console.log(`✅ DB shops with GST: ${Object.keys(dbGstMap).length}`);
    console.log(`✅ DB shops with Phone: ${Object.keys(dbPhoneMap).length}`);

    // Step 3: Zoho contacts-ஐ loop — GST match first, phone fallback
    console.log("\n💾 Building cache (Zoho-driven)...\n");

    let cached = 0;
    let skipped = 0;

    for (const contact of allContacts) {
      let shop = null;
      let matchType = null;
      let matchKey = null;

      // Try GST match first
      if (contact.gst_no) {
        const zohoGst = contact.gst_no.toUpperCase();
        shop = dbGstMap[zohoGst] || null;
        if (shop) {
          matchType = "gst";
          matchKey = zohoGst;
        }
      }

      // Fallback: phone match
      if (!shop) {
        const zohoPhone = normalizePhone(contact.phone);
        const zohoMobile = normalizePhone(contact.mobile);
        shop = dbPhoneMap[zohoPhone] || dbPhoneMap[zohoMobile] || null;
        if (shop) {
          matchType = "phone";
          matchKey = zohoPhone || zohoMobile;
        }
      }

      // ✅ DB-ல் இல்லன்னா skip — invoice call வேண்டாம்
      if (!shop) {
        skipped++;
        continue;
      }

      // Rate limit avoid
      await new Promise((r) => setTimeout(r, 200));

      // ✅ DB match ஆனவங்களுக்கு மட்டும் invoice fetch
      const invoices = await fetchInvoices(contact.contact_id, accessToken);
      const totalBilled = invoices.reduce((s, i) => s + (i.total || 0), 0);
      const outstanding = invoices.reduce((s, i) => s + (i.balance || 0), 0);

      // Cache key: GST match aana GST vachu, phone match aana shop_id vachu
      const cacheKey =
        matchType === "gst"
          ? `ZOHO_CACHE#${matchKey}`
          : `ZOHO_CACHE#SHOP#${shop.shop_id}`;

      await ddb.send(
        new PutCommand({
          TableName: CACHE_TABLE,
          Item: {
            pk: cacheKey,
            sk: "DATA",
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            gst:
              matchType === "gst"
                ? matchKey
                : shop.gstNumber || shop.gst_number || "",
            companyId: shop.companyId,
            matched: true,
            match_type: matchType,
            zoho_name: contact.contact_name,
            zoho_gst: contact.gst_no || "",
            zoho_phone: contact.phone || contact.mobile || "",
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
          },
        }),
      );

      console.log(`✅ [${matchType}] ${shop.shop_name} → ${matchKey}`);
      cached++;
    }

    console.log("\n===========================================");
    console.log(`✅ Cache build complete!`);
    console.log(`   Cached : ${cached}  (DB + Zoho matched — gst or phone)`);
    console.log(`   Skipped: ${skipped} (Zoho-ல் இருக்கு, DB-ல் இல்லை)`);
    console.log("===========================================\n");
  } catch (err) {
    console.error("❌ Cache build failed:", err.response?.data || err.message);
  }
};

// ─── Cron: 2AM Daily ─────────────────────────────────
cron.schedule("*/3 * * * *", () => {
  console.log("🕛 Cron triggered at:", new Date().toISOString());
  buildZohoCache();
});

console.log("✅ Zoho cache cron scheduled");

module.exports = { buildZohoCache };
