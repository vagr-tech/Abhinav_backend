const ddb = require("../config/dynamo");
const {
  ScanCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const XLSX = require("xlsx");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const SHOP_TABLE = "abhinav_shops";
const USER_TABLE = "abhinav_users";
const VISIT_HISTORY_TABLE = "abhinav_visit_history";

// ==============================
// LIST SHOPS (Role Based + Search)
// ==============================
exports.listShops = async (req, res) => {
  try {
    let filterExpression =
      "sk = :profile AND #companyId = :cid AND (attribute_not_exists(isDeleted) OR isDeleted = :false)";

    let expressionValues = {
      ":profile": "PROFILE",
      ":false": false,
      ":cid": req.user.companyId,
    };

    let expressionNames = {
      "#companyId": "companyId",
    };

    const role = (req.user.role || "").toLowerCase();

    // 👷 SALESMAN → only own shops
    if (role === "salesman") {
      filterExpression +=
        " AND (createdByUserId = :uid OR isCompanyWide = :true)";
      expressionValues[":uid"] = req.user.user_id || req.user.id;
      expressionValues[":true"] = true;
    }

    // 🧑‍💼 MANAGER → segment wise
    else if (role === "manager") {
      filterExpression += " AND #segment = :segment AND #status = :approved";
      expressionValues[":segment"] = (req.user.segment || "").trim();
      expressionValues[":approved"] = "approved";

      expressionNames["#segment"] = "segment";
      expressionNames["#status"] = "status";
    }

    // 👑 MASTER → all company shops
    else if (role === "master") {
      filterExpression += " AND #status = :approved";
      expressionValues[":approved"] = "approved";
      expressionNames["#status"] = "status";
    }

    // 🔍 Search support
    if (req.query.search) {
      filterExpression += " AND contains(shop_name, :search)";
      expressionValues[":search"] = req.query.search;
    }

    let items = [];
    let lastKey = undefined;

    // 🔁 Scan ALL pages
    do {
      const result = await ddb.send(
        new ScanCommand({
          TableName: SHOP_TABLE,
          FilterExpression: filterExpression,
          ExpressionAttributeValues: expressionValues,
          ExpressionAttributeNames: expressionNames,
          ExclusiveStartKey: lastKey,
        }),
      );

      items.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const shops = items.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );

    res.json({ success: true, shops });
  } catch (err) {
    console.error("LIST SHOP ERROR:", err);
    res.status(500).json({ success: false, message: "Failed to fetch shops" });
  }
};
// ==============================
// ADD SHOP
// ==============================
exports.addShop = async (req, res) => {
  try {
    const {
      shop_name,
      address,
      lat,
      lng,
      segment,
      shopImage,
      primaryPhone,
      secondaryPhone,
      shopType,
      gstType,
      gstNumber,
    } = req.body;

    if (!primaryPhone) {
      return res.status(400).json({
        success: false,
        message: "Primary phone number is required",
      });
    }

    const shopId = uuidv4();

    const shop = {
      pk: `SHOP#${shopId}`,
      sk: "PROFILE",

      shop_id: shopId,
      shop_name,
      address: address || "",
      lat: Number(lat) || 0,
      lng: Number(lng) || 0,

      segment: (segment || "").toLowerCase(),

      // 🔥 ADD PHONES HERE
      primaryPhone: primaryPhone || "",
      secondaryPhone: secondaryPhone || "",
      shopType: shopType || "office",

      gstType: gstType || "non_gst",
      gstNumber: gstNumber || "",

      status: "pending",
      isDeleted: false,

      companyId: req.user.companyId,
      companyName: req.user.companyName,

      shopImage: shopImage || "",

      createdByUserId: req.user.id,
      createdByUserName: req.user.name,

      createdAt: new Date().toISOString(),
    };

    await ddb.send(
      new PutCommand({
        TableName: SHOP_TABLE,
        Item: shop,
      }),
    );

    res.json({ success: true, shop });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};
//==============================
//ADD CALL LOGS
//==============================
exports.addCallLog = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { fromNumber, durationSec } = req.body;

    if (!fromNumber || durationSec === undefined) {
      return res.status(400).json({
        success: false,
        message: "fromNumber and durationSec required",
      });
    }

    // 1) get shop profile (for shopName, segment, companyId, primaryPhone)
    const shopData = await ddb.send(
      new GetCommand({
        TableName: SHOP_TABLE,
        Key: { pk: `SHOP#${shopId}`, sk: "PROFILE" },
      }),
    );

    if (!shopData.Item) {
      return res
        .status(404)
        .json({ success: false, message: "Shop not found" });
    }

    const shop = shopData.Item;

    const timestamp = new Date().toISOString();

    // 2) build history item
    const historyItem = {
      pk: `USER#${req.user.id}`, // Salesman-wise history fast
      sk: `CALL#${timestamp}`, // sort by time

      history_id: uuidv4(),

      shop_id: shopId,
      shop_name: shop.shop_name,
      segment: shop.segment || "",
      companyId: shop.companyId,
      companyName: shop.companyName,

      ownerPhone: shop.primaryPhone || "", // shop owner number
      fromNumber, // caller
      durationSec: Number(durationSec),

      createdByUserId: req.user.id,
      salesmanId: req.user.id,
      salesmanName: req.user.name,
      role: req.user.role,

      createdAt: timestamp,
    };

    // 3) save to visit history table
    await ddb.send(
      new PutCommand({
        TableName: "abhinav_visit_history",
        Item: historyItem,
      }),
    );

    res.json({ success: true, message: "Call log saved in visit history" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
//==============================
//GET OWNER CALL DURATION
//==============================
exports.getOwnerCallDuration = async (req, res) => {
  try {
    const { shopId } = req.params;

    const data = await ddb.send(
      new QueryCommand({
        TableName: SHOP_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": `SHOP#${shopId}`,
        },
      }),
    );

    const items = data.Items || [];

    if (items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    const profile = items.find((item) => item.sk === "PROFILE");

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Shop profile missing",
      });
    }

    const calls = items.filter((item) => item.sk.startsWith("CALL#"));

    const totalDuration = calls.reduce((sum, call) => {
      return sum + (call.durationSec || 0);
    }, 0);

    res.json({
      success: true,
      ownerPhone: profile.primaryPhone,
      callCount: calls.length,
      totalDurationSec: totalDuration,
      totalMinutes: (totalDuration / 60).toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
// ==============================
// ADD CALL LOG USING PHONE
// ==============================
exports.addCallLogByPhone = async (req, res) => {
  try {
    const { phone, durationSec } = req.body;

    if (!phone || durationSec === undefined) {
      return res.status(400).json({
        success: false,
        message: "phone and durationSec required",
      });
    }

    // 🔍 Find shop using phone
    const shopResult = await ddb.send(
      new ScanCommand({
        TableName: SHOP_TABLE,
        FilterExpression: "primaryPhone = :phone OR secondaryPhone = :phone",
        ExpressionAttributeValues: {
          ":phone": phone,
        },
      }),
    );

    if (!shopResult.Items || shopResult.Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No shop found for this phone number",
      });
    }

    const shop = shopResult.Items[0];

    const timestamp = new Date().toISOString();

    const historyItem = {
      pk: `USER#${req.user?.id || "SYSTEM"}`,
      sk: `CALL#${timestamp}`,

      history_id: uuidv4(),

      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      segment: shop.segment || "",
      companyId: shop.companyId,
      companyName: shop.companyName,

      ownerPhone: shop.primaryPhone || "",
      fromNumber: phone,
      durationSec: Number(durationSec),

      salesmanId: req.user?.id || "SYSTEM",
      salesmanName: req.user?.name || "SYSTEM",
      role: req.user?.role || "SYSTEM",

      createdAt: timestamp,
    };

    await ddb.send(
      new PutCommand({
        TableName: VISIT_HISTORY_TABLE,
        Item: historyItem,
      }),
    );

    res.json({
      success: true,
      message: "Call log saved using phone match",
    });
  } catch (err) {
    console.error("CALL LOG PHONE API ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};
// ==============================
// BULK UPLOAD FROM EXCEL (SMART UPSERT + IMAGE)
// ==============================
exports.bulkUploadFromExcel = async (req, res) => {
  try {
    // =========================
    // 1️⃣ FILE VALIDATION
    // =========================
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: "Excel file required",
      });
    }

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid Excel file",
      });
    }

    const sheetNames = workbook.SheetNames;
    if (!Array.isArray(sheetNames) || sheetNames.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Excel has no sheets",
      });
    }

    const sheet = workbook.Sheets[sheetNames[0]];
    if (!sheet) {
      return res.status(400).json({
        success: false,
        message: "Unable to read sheet",
      });
    }

    const rawRows = XLSX.utils.sheet_to_json(sheet);
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Excel empty",
      });
    }

    // =========================
    // 2️⃣ PROCESSING
    // =========================
    let inserted = 0;
    let updated = 0;
    let missingSO = [];

    for (const rawRow of rawRows) {
      // 🔥 Normalize Excel headers
      const row = {};
      Object.keys(rawRow).forEach((key) => {
        row[key.trim()] = rawRow[key];
      });

      const shopName = String(row.shop_name || "").trim();
      const soName = String(row.so_username || "").trim();

      if (!shopName) continue;

      if (!soName) {
        missingSO.push("EMPTY_SO_USERNAME");
        continue;
      }

      // =========================
      // 3️⃣ FIND SALESMAN
      // =========================
      const userResult = await ddb.send(
        new ScanCommand({
          TableName: USER_TABLE,
          FilterExpression: "#name = :uname AND #companyId = :cid",
          ExpressionAttributeNames: {
            "#name": "name",
            "#companyId": "companyId",
          },
          ExpressionAttributeValues: {
            ":uname": soName,
            ":cid": req.user.companyId,
          },
        }),
      );

      if (!userResult.Items || userResult.Items.length === 0) {
        missingSO.push(soName);
        continue;
      }

      const soUser = userResult.Items[0];
      const soId =
        soUser.user_id ||
        (typeof soUser.pk === "string" ? soUser.pk.replace("USER#", "") : "");

      // =========================
      // 4️⃣ DUPLICATE CHECK (COMPANY SAFE)
      // =========================
      const existingShop = await ddb.send(
        new ScanCommand({
          TableName: SHOP_TABLE,
          FilterExpression:
            "sk = :profile AND #companyId = :cid AND shop_name = :name AND (attribute_not_exists(isDeleted) OR isDeleted = :false)",
          ExpressionAttributeNames: {
            "#companyId": "companyId",
          },
          ExpressionAttributeValues: {
            ":profile": "PROFILE",
            ":cid": req.user.companyId,
            ":name": shopName,
            ":false": false,
          },
        }),
      );

      // =========================
      // 5️⃣ UPDATE IF EXISTS
      // =========================
      if (Array.isArray(existingShop.Items) && existingShop.Items.length > 0) {
        const shop = existingShop.Items[0];

        await ddb.send(
          new UpdateCommand({
            TableName: SHOP_TABLE,
            Key: { pk: shop.pk, sk: "PROFILE" },
            UpdateExpression:
              "SET shop_name = :name, region = :region, address = :address, #segment = :segment, lat = :lat, lng = :lng, createdByUserId = :uid, createdByUserName = :uname, companyId = :cid, companyName = :cname",
            ExpressionAttributeNames: {
              "#segment": "segment",
            },
            ExpressionAttributeValues: {
              ":name": shopName,
              ":region": row.region || "",
              ":address": row.address || "",
              ":segment": (row.segment || "").toLowerCase(),
              ":lat": Number(row.lat) || 0,
              ":lng": Number(row.lng) || 0,
              ":uid": soId,
              ":uname": soUser.name,
              ":cid": req.user.companyId,
              ":cname": req.user.companyName,
            },
          }),
        );

        updated++;
      } else {
        // =========================
        // 6️⃣ INSERT NEW
        // =========================
        const shopId = uuidv4();

        await ddb.send(
          new PutCommand({
            TableName: SHOP_TABLE,
            Item: {
              pk: `SHOP#${shopId}`,
              sk: "PROFILE",
              shop_id: shopId,
              shop_name: shopName,
              address: row.address || "",
              region: row.region || "",
              lat: Number(row.lat) || 0,
              lng: Number(row.lng) || 0,
              segment: (row.segment || "").toLowerCase(),
              status: "approved",
              isDeleted: false,
              createdByUserId: soId,
              createdByUserName: soUser.name,
              companyId: req.user.companyId,
              companyName: req.user.companyName,
              createdAt: new Date().toISOString(),
            },
          }),
        );

        inserted++;
      }
    }

    // =========================
    // 7️⃣ RESPONSE
    // =========================
    return res.json({
      success: true,
      inserted,
      updated,
      missingSO,
    });
  } catch (e) {
    console.error("EXCEL UPLOAD ERROR:", e);
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
};
// ==============================
// APPROVE SHOP
// ==============================
exports.approveShop = async (req, res) => {
  try {
    const shopId = req.params.id;

    await ddb.send(
      new UpdateCommand({
        TableName: SHOP_TABLE,
        Key: { pk: `SHOP#${shopId}`, sk: "PROFILE" },
        UpdateExpression:
          "SET #status = :approved, approvedBy = :by, approvedAt = :at",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":approved": "approved",
          ":by": req.user?.name || "",
          ":at": new Date().toISOString(),
        },
      }),
    );

    res.json({ success: true, message: "Shop approved" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

// ==============================
// UPDATE SHOP
// ==============================
exports.updateShop = async (req, res) => {
  try {
    const shopId = req.params.id;
    const {
      shop_name,
      address,
      segment,
      lat,
      lng,
      gstNumber,
      primaryPhone,
      secondaryPhone,
    } = req.body;

    if (!primaryPhone) {
      return res.status(400).json({
        success: false,
        message: "Primary phone number is required",
      });
    }

    let updateExp =
      "SET shop_name = :shop_name, address = :address, #seg = :segment, " +
      "primaryPhone = :primaryPhone, secondaryPhone = :secondaryPhone, gstNumber = :gstNumber";

    const attrNames = { "#seg": "segment" };

    const attrValues = {
      ":shop_name": shop_name,
      ":address": address,
      ":segment": segment,
      ":primaryPhone": primaryPhone || "",
      ":secondaryPhone": secondaryPhone || "",
      ":gstNumber": gstNumber || "",
    };

    // Only update lat/lng if provided
    if (lat !== undefined && lng !== undefined) {
      updateExp += ", lat = :lat, lng = :lng";
      attrValues[":lat"] = Number(lat);
      attrValues[":lng"] = Number(lng);
    }

    await ddb.send(
      new UpdateCommand({
        TableName: SHOP_TABLE,
        Key: { pk: `SHOP#${shopId}`, sk: "PROFILE" },
        UpdateExpression: updateExp,
        ExpressionAttributeNames: attrNames,
        ExpressionAttributeValues: attrValues,
      }),
    );

    res.json({ success: true, message: "Shop updated" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

// ==============================
// SOFT DELETE
// ==============================
exports.softDeleteShop = async (req, res) => {
  try {
    const shopId = req.params.id;

    await ddb.send(
      new UpdateCommand({
        TableName: SHOP_TABLE,
        Key: { pk: `SHOP#${shopId}`, sk: "PROFILE" },
        UpdateExpression: "SET isDeleted = :true, deletedAt = :at",
        ExpressionAttributeValues: {
          ":true": true,
          ":at": new Date().toISOString(),
        },
      }),
    );

    res.json({ success: true, message: "Shop deleted" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

// ==============================
// UPDATE SHOP IMAGE
// ==============================
exports.updateShopImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { shopImage } = req.body;

    if (!shopImage) {
      return res.status(400).json({
        success: false,
        message: "shopImage required",
      });
    }

    await ddb.send(
      new UpdateCommand({
        TableName: SHOP_TABLE,
        Key: {
          pk: `SHOP#${id}`,
          sk: "PROFILE",
        },
        UpdateExpression: "SET shopImage = :img",
        ExpressionAttributeValues: {
          ":img": shopImage,
        },
      }),
    );

    res.json({
      success: true,
      message: "Shop image updated successfully",
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
};

// GST Lookup - fetch shop details by GST number
exports.getShopByGst = async (req, res) => {
  try {
    const { gstNumber } = req.params;

    if (!gstNumber || gstNumber.trim().length < 15) {
      return res.status(400).json({
        success: false,
        message: "Invalid GST number",
      });
    }

    // ✅ DynamoDB Scan (same pattern as rest of your controller)
    const result = await ddb.send(
      new ScanCommand({
        TableName: SHOP_TABLE,
        FilterExpression:
          "sk = :profile AND gstNumber = :gst AND #companyId = :cid",
        ExpressionAttributeNames: {
          "#companyId": "companyId",
        },
        ExpressionAttributeValues: {
          ":profile": "PROFILE",
          ":gst": gstNumber.trim().toUpperCase(),
          ":cid": req.user.companyId,
        },
      }),
    );

    if (!result.Items || result.Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No shop found with this GST number",
      });
    }

    const shop = result.Items[0];

    return res.status(200).json({
      success: true,
      data: {
        shop_name: shop.shop_name,
        address: shop.address,
        primaryPhone: shop.primaryPhone,
        secondaryPhone: shop.secondaryPhone,
        gstNumber: shop.gstNumber,
      },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: e.message,
    });
  }
};
