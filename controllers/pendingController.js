const ddb = require("../config/dynamo");
const { ScanCommand, PutCommand, UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const TABLE_NAME = "abhinav_shops";

// ======================
// SALESMAN → ADD PENDING SHOP (Dynamo)
// ======================
exports.add = async (req, res) => {
  try {
    const { shop_name, address, lat, lng, segment, shopImage } = req.body;

    if (!shop_name) {
      return res.status(400).json({ success: false, message: "shop_name required" });
    }

    // ✅ Salesman only add their segment shop
    const finalSegment = (segment || req.user.segment || "").trim();

    const shopId = require("uuid").v4();

    const item = {
      pk: `SHOP#${shopId}`,
      sk: "PROFILE",
      shop_id: shopId,
      shop_name,
      address: address || "",
      lat: Number(lat) || 0,
      lng: Number(lng) || 0,

      segment: finalSegment,
      status: "pending",
      isDeleted: false,

      shopImage: shopImage || "",

      createdByUserId: req.user.id,
      createdByUserName: req.user.name,

      // ✅ IMPORTANT: company isolation
      companyId: req.user.companyId,
      companyName: req.user.companyName,

      createdAt: new Date().toISOString(),
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    res.json({ success: true, shop: item });
  } catch (err) {
    console.error("ADD PENDING ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ======================
// MANAGER / MASTER → LIST PENDING (company filter)
// ======================
const { QueryCommand } = require("@aws-sdk/lib-dynamodb");

exports.listPending = async (req, res) => {
  try {
    const role = (req.user.role || "").toLowerCase();

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "company-status-index",
        KeyConditionExpression: "#companyId = :cid AND #status = :pending",
        ExpressionAttributeNames: {
          "#companyId": "companyId",
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":cid": req.user.companyId,
          ":pending": "pending",
        },
      })
    );

    let shops = result.Items || [];

    // Manager segment filter
    if (role === "manager") {
      const seg = (req.user.segment || "").trim();
      shops = shops.filter((s) => s.segment === seg);
    }

    shops.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, shops });

  } catch (err) {
    console.error("LIST PENDING ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ======================
// MANAGER / MASTER → APPROVE (Dynamo Update)
// ======================
exports.approve = async (req, res) => {
  try {
    const shopId = req.params.id;

    // ✅ validate shop exists + same company
    const existing = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk: `SHOP#${shopId}`, sk: "PROFILE" },
      })
    );

    if (!existing.Item) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    if (existing.Item.companyId !== req.user.companyId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `SHOP#${shopId}`, sk: "PROFILE" },
        UpdateExpression: "SET #status = :approved, approvedBy = :by, approvedAt = :at",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":approved": "approved",
          ":by": req.user.name || "",
          ":at": new Date().toISOString(),
        },
      })
    );

    res.json({ success: true, message: "Shop approved" });
  } catch (err) {
    console.error("APPROVE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ======================
// MANAGER / MASTER → REJECT (already Dynamo)
// ======================
exports.rejectShop = async (req, res) => {
  try {
    const shopId = req.params.id;

    const existing = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk: `SHOP#${shopId}`, sk: "PROFILE" },
      })
    );

    if (!existing.Item) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    if (existing.Item.companyId !== req.user.companyId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `SHOP#${shopId}`, sk: "PROFILE" },
        UpdateExpression: "SET #status = :rejected, rejectedBy = :by, rejectedAt = :at",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":rejected": "rejected",
          ":by": req.user?.name || "",
          ":at": new Date().toISOString(),
        },
      })
    );

    res.json({ success: true, message: "Shop rejected successfully" });
  } catch (e) {
    console.error("REJECT SHOP ERROR:", e);
    res.status(500).json({ success: false, error: e.message });
  }
};