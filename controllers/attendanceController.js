// attendanceController.js
// Changes from original:
//   1. checkIn  → checks BOTH office locations + shop locations
//   2. checkOut → checks BOTH office locations + shop locations
//   3. saveVisit auto checkin/checkout block → REMOVED

const { Attendance } = require("../models/attendanceModel");
const { calculateDistance } = require("../utils/distanceCalculator");
const Location = require("../models/locationModel");
const ddb = require("../config/dynamo");
const { ScanCommand } = require("@aws-sdk/lib-dynamodb");

const SHOP_TABLE = "abhinav_shops";

const todayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function getAttendanceDateIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  const hours = istTime.getUTCHours();
  if (hours < 4) {
    istTime.setUTCDate(istTime.getUTCDate() - 1);
  }
  return istTime.toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────
// Helper: check lat/lng against office locations + shop locations
// Returns matched location info or null
// ─────────────────────────────────────────────────────────────
async function findMatchedLocation(lat, lng, companyId) {
  // ── 1. Check office locations (existing) ──
  const officeLocations = await Location.getByCompany(companyId);

  if (officeLocations && officeLocations.length > 0) {
    for (const loc of officeLocations) {
      const d = calculateDistance(lat, lng, loc.lat, loc.lng);
      if (d <= loc.radius) {
        return {
          locationId: loc.locationId,
          locationName: loc.name,
          distance: Math.round(d),
          type: "office",
        };
      }
    }
  }

  // ── 2. Check shop locations ──
  // Scan approved shops for this company
  let items = [];
  let lastKey = undefined;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: SHOP_TABLE,
        FilterExpression:
          "sk = :profile AND #companyId = :cid AND #status = :approved AND (attribute_not_exists(isDeleted) OR isDeleted = :false)",
        ExpressionAttributeNames: {
          "#companyId": "companyId",
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":profile": "PROFILE",
          ":cid": companyId,
          ":approved": "approved",
          ":false": false,
        },
        // Only fetch fields we need — faster scan
        ProjectionExpression: "shop_id, shop_name, lat, lng, #status",
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Default shop radius: 200 meters
  // You can make this configurable later
  const SHOP_RADIUS_METERS = 200;

  for (const shop of items) {
    if (!shop.lat || !shop.lng) continue;
    const d = calculateDistance(lat, lng, shop.lat, shop.lng);
    if (d <= SHOP_RADIUS_METERS) {
      return {
        locationId: `SHOP#${shop.shop_id}`,
        locationName: shop.shop_name,
        distance: Math.round(d),
        type: "shop",
      };
    }
  }

  return null; // not in any office or shop
}

// ─── CHECK IN ───────────────────────────────────────────────
module.exports.checkIn = async (req, res) => {
  const { lat, lng } = req.body;

  const uid = req.user.user_id || req.user.id;
  const userName = req.user.name || "UNKNOWN";
  const companyId = req.user.companyId;
  const companyName = req.user.companyName || "";

  if (!lat || !lng) {
    return res.json({ ok: false, error: "location_required" });
  }

  // Check both office + shop locations
  const matched = await findMatchedLocation(lat, lng, companyId);

  if (!matched) {
    return res.json({ ok: false, error: "outside_all_locations" });
  }

  try {
    await Attendance.checkIn({
      uid,
      userName,
      companyId,
      companyName,
      date: todayIST(),
      lat,
      lng,
      distance: matched.distance,
      locationId: matched.locationId,
      locationName: matched.locationName,
    });

    res.json({
      ok: true,
      locationName: matched.locationName,
      locationType: matched.type, // "office" or "shop" — Flutter uses this
    });
  } catch (e) {
    console.error("CHECKIN ERROR:", e);
    res.json({ ok: false, error: "already_checked_in" });
  }
};

// ─── CHECK OUT ──────────────────────────────────────────────
module.exports.checkOut = async (req, res) => {
  const { lat, lng } = req.body;

  const uid = req.user.user_id || req.user.id;
  const companyId = req.user.companyId;

  if (!lat || !lng) {
    return res.json({ ok: false, error: "location_required" });
  }

  // Check both office + shop locations
  const matched = await findMatchedLocation(lat, lng, companyId);

  if (!matched) {
    return res.json({ ok: false, error: "outside_all_locations" });
  }

  const attendance = await Attendance.get(uid, getAttendanceDateIST());

  if (!attendance) {
    return res.json({ ok: false, error: "no_checkin_found" });
  }

  const attendanceDate = attendance.SK.replace("DATE#", "");

  try {
    await Attendance.checkOut({
      uid,
      date: attendanceDate,
      lat,
      lng,
      locationId: matched.locationId,
      locationName: matched.locationName,
      distance: matched.distance,
    });

    res.json({
      ok: true,
      locationName: matched.locationName,
      locationType: matched.type,
    });
  } catch (e) {
    console.error("CHECKOUT ERROR:", e);
    res.json({ ok: false, error: "already_checked_out" });
  }
};

// ─── ATTENDANCE DASHBOARD (unchanged) ───────────────────────
module.exports.getAttendanceReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const companyId = req.user.companyId;

    if (!startDate || !endDate) {
      return res.json({ ok: false, error: "startDate & endDate required" });
    }

    const result = await ddb.send(
      new ScanCommand({
        TableName: "abhinav_attendance",
        FilterExpression: "companyId = :cid AND GSI1PK BETWEEN :start AND :end",
        ExpressionAttributeValues: {
          ":cid": companyId,
          ":start": `DATE#${startDate}`,
          ":end": `DATE#${endDate}`,
        },
      }),
    );

    const records = result.Items || [];
    const userMap = {};

    records.forEach((r) => {
      const name = r.userName || "Unknown";
      const date = r.GSI1PK?.replace("DATE#", "") || "";

      if (!userMap[name]) {
        userMap[name] = { name, totalDays: 0, presentDays: [], records: [] };
      }

      userMap[name].totalDays += 1;
      userMap[name].presentDays.push(date);
      userMap[name].records.push({
        date,
        checkInAt: r.checkInAt || null,
        checkOutAt: r.checkOutAt || null,
        checkInLocation: r.checkInLocationName || null,
        checkOutLocation: r.checkOutLocationName || null,
        status: r.status || "CHECKED_IN",
      });
    });

    res.json({
      ok: true,
      totalRecords: records.length,
      attendanceReport: Object.values(userMap),
    });
  } catch (e) {
    console.error("ATTENDANCE REPORT ERROR:", e);
    res.json({ ok: false, error: e.message });
  }
};
