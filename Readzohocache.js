// readZohoCache.js
// Use this in getVisits, getShopsOutstanding, etc. instead of calling Zoho directly

const { GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const ddb = require("./config/dynamo");

const CACHE_TABLE = "abhinav_zoho_cache";

// ─── Read cache for ONE shop (by GST or shop_id) ──────────
const getZohoCacheForShop = async (gstNumber, shopId) => {
  try {
    // 1️⃣ Try GST-based key first (uppercase GST)
    if (gstNumber) {
      const result = await ddb.send(
        new GetCommand({
          TableName: CACHE_TABLE,
          Key: {
            pk: `ZOHO_CACHE#${gstNumber.toUpperCase()}`,
            sk: "DATA",
          },
        }),
      );
      if (result.Item) return result.Item;
    }

    // 2️⃣ Fallback: phone-matched shops are stored as ZOHO_CACHE#SHOP#<shop_id>
    if (shopId) {
      const result = await ddb.send(
        new GetCommand({
          TableName: CACHE_TABLE,
          Key: {
            pk: `ZOHO_CACHE#SHOP#${shopId}`,
            sk: "DATA",
          },
        }),
      );
      if (result.Item) return result.Item;
    }

    return null;
  } catch (err) {
    console.error("Cache read error:", err.message);
    return null;
  }
};

// ─── Read cache for ALL shops (for outstanding page) ──────
const getAllZohoCache = async () => {
  let items = [];
  let lastKey;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: CACHE_TABLE,
        FilterExpression: "sk = :data",
        ExpressionAttributeValues: { ":data": "DATA" },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
};

module.exports = { getZohoCacheForShop, getAllZohoCache };
