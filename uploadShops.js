require("dotenv").config();
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const { parse } = require("csv-parse/sync");

// ==============================
// DYNAMO SETUP (dynamo.js போல)
// ==============================
const client = new DynamoDBClient({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ddb = DynamoDBDocumentClient.from(client);

const SHOP_TABLE = "abhinav_shops";

const MASTER = {
  companyId: "CMP1777273345850",
  companyName: "VAGR_BOVONTO",
  id: "8f14d95b-d88c-4842-8e83-67211bc58d57",
  name: "HaranAjay",
};

async function uploadShops() {
  const fileContent = fs.readFileSync("./shops.csv", "utf-8");

  const rows = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`📋 Total rows in CSV: ${rows.length}`);

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const shopName = String(row.shop_name || "").trim();
    if (!shopName) {
      skipped++;
      continue;
    }

    const existing = await ddb.send(
      new ScanCommand({
        TableName: SHOP_TABLE,
        FilterExpression:
          "sk = :profile AND #companyId = :cid AND shop_name = :name AND (attribute_not_exists(isDeleted) OR isDeleted = :false)",
        ExpressionAttributeNames: { "#companyId": "companyId" },
        ExpressionAttributeValues: {
          ":profile": "PROFILE",
          ":cid": MASTER.companyId,
          ":name": shopName,
          ":false": false,
        },
      }),
    );

    if (existing.Items?.length > 0) {
      console.log(`⚠️  Skipped (duplicate): ${shopName}`);
      skipped++;
      continue;
    }

    const shopId = uuidv4();

    await ddb.send(
      new PutCommand({
        TableName: SHOP_TABLE,
        Item: {
          pk: `SHOP#${shopId}`,
          sk: "PROFILE",
          shop_id: shopId,
          shop_name: shopName,
          lat: Number(row.lat) || 0,
          lng: Number(row.lng) || 0,
          address: row.address || "",
          segment: (row.segment || "").toLowerCase(),
          status: "approved",
          isDeleted: false,
          isCompanyWide: true,
          createdByUserId: MASTER.id,
          createdByUserName: MASTER.name,
          companyId: MASTER.companyId,
          companyName: MASTER.companyName,
          createdAt: new Date().toISOString(),
        },
      }),
    );

    console.log(`✅ Inserted: ${shopName}`);
    inserted++;
  }

  console.log(`\n🎉 Done — Inserted: ${inserted}, Skipped: ${skipped}`);
}

uploadShops();
