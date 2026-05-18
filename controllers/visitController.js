const ddb = require("../config/dynamo");
const {
  PutCommand,
  ScanCommand,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");
const { getAccessToken, getShopSales } = require("../services/zohoService");
const { Attendance } = require("../models/attendanceModel");

const SHOP_TABLE = "abhinav_shops";
const TABLE_NAME = "abhinav_visit_history";
const VISIT_HISTORY_TABLE = "abhinav_visit_history";

exports.getCallHistory = async (req, res) => {
  try {
    // salesman -> own history
    if (req.user.role === "salesman") {
      const data = await ddb.send(
        new QueryCommand({
          TableName: VISIT_HISTORY_TABLE,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: {
            ":pk": `USER#${req.user.id}`,
            ":sk": "CALL#",
          },
          ScanIndexForward: false, // latest first
        }),
      );

      return res.json({ success: true, logs: data.Items || [] });
    }

    // manager/master: for now return error until we add GSI (next step)
    return res.status(400).json({
      success: false,
      message:
        "Manager/Master history needs GSI (segment/company) - next step implement pannalam",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
// ============================
// SOFT DELETE VISIT (MASTER / MANAGER)
// ============================
exports.deleteVisit = async (req, res) => {
  try {
    const { pk, sk } = req.body;

    if (!pk || !sk) {
      return res.status(400).json({
        success: false,
        message: "pk & sk required",
      });
    }

    // 🔎 Check visit exists
    const visitRes = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
      }),
    );

    const visit = visitRes.Item;

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: "Visit not found",
      });
    }

    // 🔒 Company isolation
    if (visit.companyId !== req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden (other company data)",
      });
    }

    const role = (req.user.role || "").toLowerCase();

    // 🔒 Manager segment restriction
    if (role === "manager") {
      const userSeg = (req.user.segment || "").toLowerCase().trim();
      const visitSeg = (visit.segment || "").toLowerCase().trim();

      if (userSeg !== visitSeg) {
        return res.status(403).json({
          success: false,
          message: "Forbidden (other segment visit)",
        });
      }
    }

    // ✅ SOFT DELETE (hide only)
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
        UpdateExpression:
          "SET isDeleted = :true, deletedAt = :time, deletedBy = :user",
        ExpressionAttributeValues: {
          ":true": true,
          ":time": new Date().toISOString(),
          ":user": req.user.name,
        },
      }),
    );

    res.json({
      success: true,
      message: "Visit hidden successfully",
    });
  } catch (e) {
    console.error("SOFT DELETE ERROR:", e);
    res.status(500).json({ success: false, error: e.message });
  }
};
// ============================
// SAVE VISIT (8 DAYS TTL)
// ============================
exports.saveVisit = async (req, res) => {
  try {
    const { shop_id, shop_name, result, distance } = req.body;

    const salesmanId = req.user.id;
    const salesmanName = req.user.name;
    const companyId = req.user.companyId;
    const companyName = req.user.companyName || "";

    const shopRes = await ddb.send(
      new GetCommand({
        TableName: SHOP_TABLE,
        Key: {
          pk: `SHOP#${shop_id}`,
          sk: "PROFILE",
        },
      }),
    );

    const shop = shopRes.Item;
    const now = new Date().toISOString();
    const days = 8;
    const expireAt = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;

    const item = {
      pk: `VISIT#USER#${salesmanId}`,
      sk: `SHOP#${shop_id}#${now}`,
      visit_id: uuidv4(),
      salesmanId,
      salesmanName,
      shop_id,
      shop_name,
      companyId,
      companyName,
      segment: (shop?.segment || "").toLowerCase(),
      result: result || "matched",
      gstNumber: shop?.gstNumber || shop?.gst_number || "",
      distance: distance || 0,
      status: "completed",
      createdAt: now,
      expireAt,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      }),
    );

    // ✅ MATCH VISIT - AUTO CHECKIN + YESTERDAY CHECKOUT
    if (result === "match") {
      try {
        const todayIST = new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Kolkata",
        });

        // ✅ STEP 1: YESTERDAY AUTO CHECKOUT
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayIST = yesterdayDate.toLocaleDateString("en-CA", {
          timeZone: "Asia/Kolkata",
        });

        const yesterdayAttendance = await Attendance.get(
          salesmanId,
          yesterdayIST,
        );

        // ✅ Yesterday checkin இருக்கு but checkout இல்லன்னா
        if (
          yesterdayAttendance &&
          yesterdayAttendance.status === "CHECKED_IN"
        ) {
          // ✅ Yesterday last visit fetch
          const { QueryCommand } = require("@aws-sdk/lib-dynamodb");

          const lastVisitRes = await ddb.send(
            new QueryCommand({
              TableName: TABLE_NAME,
              KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
              FilterExpression: "result = :r",
              ExpressionAttributeValues: {
                ":pk": `VISIT#USER#${salesmanId}`,
                ":sk": "SHOP#",
                ":r": "match",
              },
              ScanIndexForward: false, // ✅ Latest first
              Limit: 20,
            }),
          );

          const yesterdayVisits = (lastVisitRes.Items || []).filter((v) => {
            const visitDate = new Date(v.createdAt).toLocaleDateString(
              "en-CA",
              {
                timeZone: "Asia/Kolkata",
              },
            );
            return visitDate === yesterdayIST;
          });

          if (yesterdayVisits.length > 0) {
            // ✅ Yesterday last match visit
            const lastVisit = yesterdayVisits[0];

            await Attendance.checkOut({
              uid: salesmanId,
              date: yesterdayIST,
              lat: lastVisit.lat || 0,
              lng: lastVisit.lng || 0,
              locationId: `SHOP#${lastVisit.shop_id}`,
              locationName: lastVisit.shop_name,
              distance: lastVisit.distance || 0,
            });

            console.log(
              `✅ Auto checkout (yesterday): ${salesmanName} at ${lastVisit.shop_name} - ${lastVisit.createdAt}`,
            );
          }
        }

        // ✅ STEP 2: TODAY AUTO CHECKIN
        const existing = await Attendance.get(salesmanId, todayIST);

        if (!existing) {
          await Attendance.checkIn({
            uid: salesmanId,
            userName: salesmanName,
            companyId,
            companyName,
            date: todayIST,
            lat: shop?.lat || 0,
            lng: shop?.lng || 0,
            distance: distance || 0,
            locationId: `SHOP#${shop_id}`,
            locationName: shop_name,
          });

          console.log(`✅ Auto checkin: ${salesmanName} at ${shop_name}`);
        }
      } catch (e) {
        console.error("AUTO ATTENDANCE ERROR:", e);
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("SAVE VISIT ERROR:", e);
    res.status(500).json({ success: false, error: e.message });
  }
};

// ============================
// GET VISITS (COMPANY SAFE)
// ============================

// getVisits — reads from DynamoDB cache instead of calling Zoho

exports.getVisits = async (req, res) => {
  try {
    const role = (req.user.role || "").toLowerCase();

    let filterExpression =
      "#companyId = :cid AND (attribute_not_exists(isDeleted) OR isDeleted = :false)";
    let expressionNames = { "#companyId": "companyId" };
    let expressionValues = { ":cid": req.user.companyId, ":false": false };

    if (role === "salesman") {
      filterExpression += " AND salesmanId = :uid";
      expressionValues[":uid"] = req.user.id;
    }

    if (role === "manager") {
      filterExpression += " AND #segment = :segment";
      expressionNames["#segment"] = "segment";
      expressionValues[":segment"] = (req.user.segment || "")
        .toLowerCase()
        .trim();
    }

    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: filterExpression,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
      }),
    );

    const visits = result.Items || [];

    // ✅ Read from cache — no Zoho API call
    let zoho_sales = [];
    if (role !== "driver" && visits.length > 0) {
      const { getZohoCacheForShop } = require("../Readzohocache");

      // getVisits.js - இந்த part மட்டும் மாத்து
      zoho_sales = (
        await Promise.all(
          visits.map(async (visit) => {
            const gstNumber = (
              visit.gstNumber ||
              visit.gst_number ||
              ""
            ).trim();
            const shopName = visit.shop_name || visit.shopName || "";

            // ✅ GST இல்லாட்டி skip — shopId வச்சு தேடவே வேண்டாம்
            if (!gstNumber) return null;

            const cache = await getZohoCacheForShop(gstNumber, null);
            if (!cache) return null;

            return {
              shopName,
              gstNumber,
              sales: {
                total_sales: cache.total_billed || 0,
                invoice_count: cache.invoice_count || 0,
                invoices: cache.invoices || [],
              },
            };
          }),
        )
      ).filter(Boolean);
    }

    res.json({ success: true, visits, zoho_sales });
  } catch (e) {
    console.error("GET VISITS ERROR:", e);
    res.status(500).json({ success: false, error: e.message });
  }
};
