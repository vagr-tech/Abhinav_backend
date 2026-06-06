const ddb = require("../config/dynamo");
const {
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const LIVE_TABLE = "abhinav_live_locations";

// ─────────────────────────────────────────────────────────────
// POST /api/live-location  — salesman every 1 min ping
// ─────────────────────────────────────────────────────────────
exports.updateLiveLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (lat === undefined || lng === undefined) {
      return res
        .status(400)
        .json({ success: false, message: "lat and lng are required" });
    }

    const now = new Date();
    const nowEpoch = Math.floor(now.getTime() / 1000);
    const expireAt = nowEpoch + 7 * 24 * 60 * 60; // 7 days TTL

    // Existing record எடுக்கணும்
    const existing = await ddb.send(
      new GetCommand({
        TableName: LIVE_TABLE,
        Key: { pk: req.user.id, sk: "LIVE" },
      }),
    );

    const prevPath = existing.Item?.path || [];

    // ✅ Today's points மட்டும் keep — yesterday lines வராது
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartEpoch = Math.floor(todayStart.getTime() / 1000);
    const todayPath = prevPath.filter((p) => p.t >= todayStartEpoch);

    const newPoint = { lat: Number(lat), lng: Number(lng), t: nowEpoch };
    const path = [...todayPath, newPoint];

    await ddb.send(
      new PutCommand({
        TableName: LIVE_TABLE,
        Item: {
          pk: req.user.id,
          sk: "LIVE",
          salesmanId: req.user.id,
          salesmanName: req.user.name,
          segment: (req.user.segment || "").toUpperCase(),
          companyId: req.user.companyId,
          lat: Number(lat),
          lng: Number(lng),
          path,
          isCheckedOut: false, // ✅ checkin/ping → always active
          updatedAt: now.toISOString(),
          updatedAtEpoch: nowEpoch,
          expireAt,
        },
      }),
    );

    return res.json({ success: true, message: "Location updated" });
  } catch (err) {
    console.error("LIVE LOCATION UPDATE ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/live-location  — salesman / manager / master
// ─────────────────────────────────────────────────────────────
exports.getLiveLocations = async (req, res) => {
  try {
    const role = (req.user.role || "").toLowerCase();

    // Salesman → own record மட்டும்
    if (role === "salesman") {
      const result = await ddb.send(
        new GetCommand({
          TableName: LIVE_TABLE,
          Key: { pk: req.user.id, sk: "LIVE" },
        }),
      );

      // ✅ isCheckedOut ஆனா empty return — dot மறையும்
      if (!result.Item || result.Item.isCheckedOut) {
        return res.json({ success: true, locations: [] });
      }

      return res.json({ success: true, locations: [_clean(result.Item)] });
    }

    // Manager / Master → scan
    let filterExpression = "sk = :sk AND companyId = :cid";
    const expressionValues = { ":sk": "LIVE", ":cid": req.user.companyId };
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

    // ✅ Fresh check + checked out filter
    // isCheckedOut = true → route data தெரியும், ஆனா live dot காட்டாது
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;
    const fresh = items.filter(
      (i) => (i.updatedAtEpoch || 0) >= tenMinutesAgo && !i.isCheckedOut, // ✅ checkout ஆனவங்க live dot-ல வராது
    );

    return res.json({ success: true, locations: fresh.map(_clean) });
  } catch (err) {
    console.error("GET LIVE LOCATIONS ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// PATCH /api/live-location/checkout  — checkout பண்ணும்போது
// Record DELETE பண்ணாதே — route history தெரியணும்
// isCheckedOut: true மட்டும் set பண்ணு
// ─────────────────────────────────────────────────────────────
exports.checkoutLiveLocation = async (req, res) => {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: LIVE_TABLE,
        Key: { pk: req.user.id, sk: "LIVE" },
        UpdateExpression: "SET isCheckedOut = :val",
        ExpressionAttributeValues: { ":val": true },
      }),
    );
    return res.json({
      success: true,
      message: "Checked out — route preserved",
    });
  } catch (err) {
    console.error("CHECKOUT LIVE LOCATION ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// Helper: DynamoDB item → clean response
// ─────────────────────────────────────────────────────────────
function _clean(item) {
  return {
    salesmanId: item.salesmanId,
    salesmanName: item.salesmanName,
    segment: item.segment,
    lat: Number(item.lat),
    lng: Number(item.lng),
    path: item.path || [],
    isCheckedOut: item.isCheckedOut || false, // ✅ Flutter-க்கு pass பண்ணு
    updatedAt: item.updatedAt,
    updatedAtEpoch: item.updatedAtEpoch,
  };
}
