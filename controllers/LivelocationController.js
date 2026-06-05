const ddb = require("../config/dynamo");
const {
  PutCommand,
  GetCommand,
  ScanCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const LIVE_TABLE = "abhinav_live_locations";

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

    // Existing record — path array எடுக்கணும்
    const existing = await ddb.send(
      new GetCommand({
        TableName: LIVE_TABLE,
        Key: { pk: req.user.id, sk: "LIVE" },
      }),
    );

    const prevPath = existing.Item?.path || [];
    const lastPointEpoch =
      prevPath.length > 0 ? prevPath[prevPath.length - 1].t : 0;

    const newPoint = { lat: Number(lat), lng: Number(lng), t: nowEpoch };

    const path = [...prevPath, newPoint];

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

    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;
    const fresh = items.filter((i) => (i.updatedAtEpoch || 0) >= tenMinutesAgo);

    return res.json({ success: true, locations: fresh.map(_clean) });
  } catch (err) {
    console.error("GET LIVE LOCATIONS ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

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
    path: item.path || [],
    updatedAt: item.updatedAt,
    updatedAtEpoch: item.updatedAtEpoch,
  };
}
