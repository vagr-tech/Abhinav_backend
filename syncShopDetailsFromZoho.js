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

// ==========================================
// STEP 1 — GET ZOHO ACCESS TOKEN
// ==========================================
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

// ==========================================
// STEP 2 — FETCH CONTACT FROM ZOHO BY GST
// ==========================================
async function fetchZohoContactByGst(gstNumber, accessToken) {
  try {
    const res = await axios.get(`https://www.zohoapis.in/books/v3/contacts`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      params: {
        organization_id: process.env.ZOHO_ORG_ID,
        search_text: gstNumber,
      },
    });

    const contacts = res.data.contacts || [];
    return (
      contacts.find(
        (c) => (c.gst_no || "").toUpperCase() === gstNumber.toUpperCase(),
      ) || null
    );
  } catch (e) {
    console.error(`Zoho fetch failed for ${gstNumber}:`, e.message);
    return null;
  }
}

// ==========================================
// STEP 3 — GET UNSYNCED GST SHOPS (PAGINATED)
// ==========================================
async function getAllUnsyncedGstShops() {
  const shops = [];
  let lastKey = undefined;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: SHOP_TABLE,
        FilterExpression:
          "sk = :profile AND gstType = :gst AND attribute_exists(gstNumber) AND (attribute_not_exists(zohoSynced) OR zohoSynced = :notSynced)",
        ProjectionExpression:
          "pk, sk, shop_name, address, primaryPhone, gstNumber, companyId, #seg",
        ExpressionAttributeNames: {
          "#seg": "segment",
        },
        ExpressionAttributeValues: {
          ":profile": "PROFILE",
          ":gst": "gst",
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

// ==========================================
// STEP 4 — UPDATE SHOP IN DYNAMODB
// ==========================================
async function updateShopFromZoho(pk, zohoContact) {
  const phone = zohoContact.phone || zohoContact.mobile || "";

  await ddb.send(
    new UpdateCommand({
      TableName: SHOP_TABLE,
      Key: { pk, sk: "PROFILE" },
      UpdateExpression:
        "SET shop_name = :name, address = :address, primaryPhone = :phone, zohoSynced = :synced, zohoSyncedAt = :syncedAt",
      ExpressionAttributeValues: {
        ":name": zohoContact.contact_name || "",
        ":address": zohoContact.billing_address?.address || "",
        ":phone": phone,
        ":synced": true,
        ":syncedAt": new Date().toISOString(),
      },
    }),
  );
}

// ==========================================
// MAIN CRON JOB — RUNS EVERY DAY AT 2AM
// ==========================================
function startShopSyncCron() {
  cron.schedule("*/2 * * * *", async () => {
    console.log("🔄 [CRON] Starting Zoho shop sync...");

    try {
      const accessToken = await getZohoAccessToken();
      const shops = await getAllUnsyncedGstShops();

      console.log(`📦 Total unsynced GST shops: ${shops.length}`);

      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const shop of shops) {
        if (!shop.gstNumber || shop.gstNumber.length !== 15) {
          skipped++;
          continue;
        }

        const zohoContact = await fetchZohoContactByGst(
          shop.gstNumber,
          accessToken,
        );

        if (!zohoContact) {
          console.log(`⚠️  No Zoho match for GST: ${shop.gstNumber}`);
          skipped++;
          continue;
        }

        try {
          await updateShopFromZoho(shop.pk, zohoContact);
          console.log(
            `✅ Synced: ${shop.gstNumber} → ${zohoContact.contact_name}`,
          );
          updated++;
        } catch (e) {
          console.error(`❌ Update failed for ${shop.gstNumber}:`, e.message);
          failed++;
        }

        // ✅ Avoid Zoho rate limits
        await new Promise((r) => setTimeout(r, 300));
      }

      console.log(
        `✅ [CRON] Done — Updated: ${updated} | Skipped: ${skipped} | Failed: ${failed}`,
      );
    } catch (e) {
      console.error("❌ [CRON] Sync crashed:", e.message);
    }
  });

  console.log("⏰ Shop sync cron registered — runs daily at 2AM");
}

module.exports = { startShopSyncCron };
