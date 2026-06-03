// liveLocation.controller.js
// Live Location Tracking — Node.js + DynamoDB
// Table: abhinav_live_locations
//   PK: pk (salesmanId)  SK: "LIVE"
//
// Auto-cleanup strategy (no logout needed):
//   1. TTL (expireAt) — DynamoDB deletes row if salesman stops pinging for 2 hrs
//   2. App lifecycle (didChangeAppLifecycleState) — Flutter sends DELETE on background/close
//   3. GET filter — stale rows (>10 min) hidden from map even before TTL kicks in

const ddb = require("../config/dynamo");
const {
  PutCommand,
  GetCommand,
  ScanCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const LIVE_TABLE = "abhinav_live_locations";

// ==============================
// POST /live-location
// Salesman pings every 1 minute
// Each ping resets the 2hr TTL
// ==============================
exports.updateLiveLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({
        success: false,
        message: "lat and lng are required",
      });
    }

    const now = new Date();

    // TTL = now + 2 hours
    // If salesman stops pinging (phone off / app killed),
    // DynamoDB auto-deletes this row after 2 hours
    const expireAt = Math.floor(now.getTime() / 1000) + 2 * 60 * 60;

    const item = {
      pk: req.user.id,
      sk: "LIVE",
      salesmanId: req.user.id,
      salesmanName: req.user.name,
      segment: (req.user.segment || "").toUpperCase(),
      companyId: req.user.companyId,
      lat: Number(lat),
      lng: Number(lng),
      updatedAt: now.toISOString(),
      updatedAtEpoch: Math.floor(now.getTime() / 1000),
      expireAt, // ← Enable TTL on this attribute in DynamoDB console
    };

    await ddb.send(new PutCommand({ TableName: LIVE_TABLE, Item: item }));

    return res.json({ success: true, message: "Location updated" });
  } catch (err) {
    console.error("LIVE LOCATION UPDATE ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ==============================
// GET /live-location
// Returns only FRESH locations (updated within 10 minutes)
// Stale rows stay in DB until TTL deletes them,
// but they won't show on the map
// ==============================
exports.getLiveLocations = async (req, res) => {
  try {
    const role = (req.user.role || "").toLowerCase();

    if (role === "salesman") {
      const result = await ddb.send(
        new GetCommand({
          TableName: LIVE_TABLE,
          Key: { pk: req.user.id, sk: "LIVE" },
        }),
      );
      const locations = result.Item ? [_clean(result.Item)] : [];
      return res.json({ success: true, locations });
    }

    // Manager / Master
    let filterExpression = "sk = :sk AND companyId = :cid";
    const expressionValues = {
      ":sk": "LIVE",
      ":cid": req.user.companyId,
    };
    const expressionNames = {};

    if (role === "manager") {
      filterExpression += " AND #segment = :segment";
      expressionValues[":segment"] = (req.user.segment || "").toUpperCase();
      expressionNames["#segment"] = "segment";
    }

    let items = [];
    let lastKey = undefined;

    do {
      const scanParams = {
        TableName: LIVE_TABLE,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionValues,
      };
      if (Object.keys(expressionNames).length > 0) {
        scanParams.ExpressionAttributeNames = expressionNames;
      }
      if (lastKey) scanParams.ExclusiveStartKey = lastKey;

      const result = await ddb.send(new ScanCommand(scanParams));
      items.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    // Only show locations updated within last 10 minutes
    // (covers: phone off, app killed, no network — all show as offline)
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;
    const fresh = items.filter((i) => (i.updatedAtEpoch || 0) >= tenMinutesAgo);

    return res.json({ success: true, locations: fresh.map(_clean) });
  } catch (err) {
    console.error("GET LIVE LOCATIONS ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ==============================
// DELETE /live-location
// Called by Flutter app lifecycle:
//   - App goes to background
//   - App is closed/killed (best effort)
// This is optional — TTL handles it anyway
// ==============================
exports.clearLiveLocation = async (req, res) => {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: LIVE_TABLE,
        Key: { pk: req.user.id, sk: "LIVE" },
      }),
    );
    return res.json({ success: true, message: "Live location cleared" });
  } catch (err) {
    console.error("CLEAR LIVE LOCATION ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

function _clean(item) {
  return {
    salesmanId: item.salesmanId,
    salesmanName: item.salesmanName,
    segment: item.segment,
    lat: Number(item.lat),
    lng: Number(item.lng),
    updatedAt: item.updatedAt,
    updatedAtEpoch: item.updatedAtEpoch,
  };
}
