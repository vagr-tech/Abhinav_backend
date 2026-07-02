const cron = require("node-cron");
const axios = require("axios");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddb = DynamoDBDocumentClient.from(client);
const SHOP_TABLE = process.env.SHOP_TABLE || "abhinav_shops";

async function getZohoAccessToken() {
  const res = await axios.post(
    `https://accounts.zoho.in/oauth/v2/token`,
    null,
    {
      params: {
        grant_type: "refresh_token",
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      },
    },
  );
  return res.data.access_token;
}

async function fetchAllZohoContacts(accessToken) {
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
  console.log(`📋 Zoho contacts fetched (all): ${all.length}`);
  return all;
}

function normalizePhone(p) {
  return (p || "").replace(/[\s\-]/g, "").replace(/^(\+91|91|0)/, "");
}

function matchByGst(allContacts, gstNumber) {
  if (!gstNumber) return null;
  return (
    allContacts.find(
      (c) => (c.gst_no || "").toUpperCase() === gstNumber.toUpperCase(),
    ) || null
  );
}

function matchByPhone(allContacts, phone) {
  if (!phone) return null;
  const normalizedInput = normalizePhone(phone);
  if (!normalizedInput) return null;

  return (
    allContacts.find((c) => {
      const zohoPhone = normalizePhone(c.phone);
      const zohoMobile = normalizePhone(c.mobile);
      return zohoPhone === normalizedInput || zohoMobile === normalizedInput;
    }) || null
  );
}

async function getAllUnsyncedShops() {
  const shops = [];
  let lastKey = undefined;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: SHOP_TABLE,
        FilterExpression:
          "sk = :profile AND (attribute_not_exists(zohoSynced) OR zohoSynced = :notSynced)",
        ProjectionExpression:
          "pk, sk, shop_name, address, primaryPhone, gstNumber, companyId, #seg",
        ExpressionAttributeNames: {
          "#seg": "segment",
        },
        ExpressionAttributeValues: {
          ":profile": "PROFILE",
          ":notSynced": false,
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    if (result.Items) shops.push(...result.Items);
    lastKey = result.LastEvaluatedKey;

    console.log(
      `📄 Scanned page — found ${result.Items?.length || 0} unsynced shops so far (total: ${shops.length})`,
    );
  } while (lastKey);

  return shops;
}

async function updateShopFromZoho(pk, zohoContact, matchedBy) {
  const phone = zohoContact.phone || zohoContact.mobile || "";

  await ddb.send(
    new UpdateCommand({
      TableName: SHOP_TABLE,
      Key: { pk, sk: "PROFILE" },
      UpdateExpression:
        "SET shop_name = :name, address = :address, primaryPhone = :phone, zohoSynced = :synced, zohoSyncedAt = :syncedAt, zohoMatchedBy = :matchedBy",
      ExpressionAttributeValues: {
        ":name": zohoContact.contact_name || "",
        ":address": zohoContact.billing_address?.address || "",
        ":phone": phone,
        ":synced": true,
        ":syncedAt": new Date().toISOString(),
        ":matchedBy": matchedBy,
      },
    }),
  );
}

// ─── Visit table shop_name sync helpers ────────────────────
const VISIT_HISTORY_TABLE =
  process.env.VISIT_HISTORY_TABLE || "abhinav_visit_history";

async function getAllShopsNameMap() {
  const map = {};
  let lastKey;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: SHOP_TABLE,
        FilterExpression: "sk = :profile",
        ProjectionExpression: "shop_id, shop_name",
        ExpressionAttributeValues: { ":profile": "PROFILE" },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const shop of result.Items || []) {
      if (shop.shop_id) map[shop.shop_id] = shop.shop_name || "";
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  console.log(`🏪 Shops loaded for name map: ${Object.keys(map).length}`);
  return map;
}

async function getAllVisits() {
  const visits = [];
  let lastKey;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: VISIT_HISTORY_TABLE,
        ProjectionExpression: "pk, sk, shop_id, shop_name",
        ExclusiveStartKey: lastKey,
      }),
    );
    visits.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return visits;
}

async function syncVisitShopNames() {
  console.log("\n🔄 Starting visit shop_name sync...");

  try {
    const shopNameMap = await getAllShopsNameMap();
    const visits = await getAllVisits();

    console.log(`📦 Total visits scanned: ${visits.length}`);

    let updated = 0;
    let skipped = 0;

    for (const visit of visits) {
      if (!visit.shop_id) {
        skipped++;
        continue;
      }

      const currentShopName = shopNameMap[visit.shop_id];

      if (!currentShopName || currentShopName === visit.shop_name) {
        skipped++;
        continue;
      }

      try {
        await ddb.send(
          new UpdateCommand({
            TableName: VISIT_HISTORY_TABLE,
            Key: { pk: visit.pk, sk: visit.sk },
            UpdateExpression: "SET shop_name = :name",
            ExpressionAttributeValues: { ":name": currentShopName },
          }),
        );
        console.log(
          `✅ Visit name updated: "${visit.shop_name}" → "${currentShopName}" (shop_id=${visit.shop_id})`,
        );
        updated++;
      } catch (e) {
        console.error(
          `❌ Visit update failed for pk=${visit.pk} sk=${visit.sk}:`,
          e.message,
        );
      }
    }

    console.log(
      `✅ Visit shop_name sync complete — Updated: ${updated} | Skipped: ${skipped}\n`,
    );
  } catch (err) {
    console.error("❌ Visit shop_name sync failed:", err.message);
  }
}

function startShopSyncCron() {
  cron.schedule("*/2 * * * *", async () => {
    console.log("🔄 [CRON] Starting Zoho shop sync...");

    try {
      const accessToken = await getZohoAccessToken();
      const allContacts = await fetchAllZohoContacts(accessToken);
      const shops = await getAllUnsyncedShops();

      console.log(`📦 Total unsynced shops: ${shops.length}`);

      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const shop of shops) {
        let zohoContact = null;
        let matchedBy = null;

        const hasValidGst = shop.gstNumber && shop.gstNumber.length === 15;

        if (hasValidGst) {
          zohoContact = matchByGst(allContacts, shop.gstNumber);
          if (zohoContact) matchedBy = "gst";
        }

        if (!zohoContact && shop.primaryPhone) {
          console.log(
            hasValidGst
              ? `🔁 No GST match for ${shop.gstNumber} — trying phone: ${shop.primaryPhone}`
              : `📞 No GST on record — matching by phone: ${shop.primaryPhone}`,
          );
          zohoContact = matchByPhone(allContacts, shop.primaryPhone);
          if (zohoContact) matchedBy = "phone";
        }

        if (!zohoContact) {
          console.log(
            `⚠️  No Zoho match for shop pk=${shop.pk} (GST: ${shop.gstNumber || "N/A"}, Phone: ${shop.primaryPhone || "N/A"})`,
          );
          skipped++;
          continue;
        }

        try {
          await updateShopFromZoho(shop.pk, zohoContact, matchedBy);
          console.log(
            `✅ Synced [${matchedBy}]: ${shop.gstNumber || shop.primaryPhone} → ${zohoContact.contact_name}`,
          );
          updated++;
        } catch (e) {
          console.error(`❌ Update failed for pk=${shop.pk}:`, e.message);
          failed++;
        }
      }

      console.log(
        `✅ [CRON] Shop sync done — Updated: ${updated} | Skipped: ${skipped} | Failed: ${failed}`,
      );

      // ✅ Shop names updated above — now propagate corrected names to visit history
      await syncVisitShopNames();
    } catch (e) {
      console.error("❌ [CRON] Sync crashed:", e.message);
    }
  });

  console.log("⏰ Shop sync cron registered (with visit name sync)");
}

module.exports = { startShopSyncCron };
