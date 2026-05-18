const { Attendance } = require("../models/attendanceModel");
const { calculateDistance } = require("../utils/distanceCalculator");
const Location = require("../models/locationModel");

const todayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// ─── CHECK IN ───────────────────────────────────────────────
module.exports.checkIn = async (req, res) => {
  const { lat, lng } = req.body;

  // ✅ FIXED - user_id use பண்றோம்
  const uid = req.user.user_id || req.user.id; // fallback to id if user_id is not present
  const userName = req.user.name || "UNKNOWN";
  const companyId = req.user.companyId;
  const companyName = req.user.companyName || "";

  if (!lat || !lng) {
    return res.json({ ok: false, error: "location_required" });
  }

  const locations = await Location.getByCompany(companyId);

  if (!locations || locations.length === 0) {
    return res.json({ ok: false, error: "no_locations_configured" });
  }

  let matchedLocation = null;
  let distance = null;

  for (const loc of locations) {
    const d = calculateDistance(lat, lng, loc.lat, loc.lng);
    if (d <= loc.radius) {
      matchedLocation = loc;
      distance = Math.round(d);
      break;
    }
  }

  if (!matchedLocation) {
    return res.json({ ok: false, error: "outside_all_locations" });
  }

  try {
    await Attendance.checkIn({
      uid,
      userName,
      companyId,
      companyName, // ✅ save பண்றோம்
      date: todayIST(),
      lat,
      lng,
      distance,
      locationId: matchedLocation.locationId,
      locationName: matchedLocation.name,
    });

    res.json({ ok: true, locationName: matchedLocation.name });
  } catch (e) {
    console.error("CHECKIN ERROR:", e);
    res.json({ ok: false, error: "already_checked_in" });
  }
};

// ─── CHECK OUT ──────────────────────────────────────────────
module.exports.checkOut = async (req, res) => {
  const { lat, lng } = req.body;

  // ✅ FIXED - user_id use பண்றோம்
  const uid = req.user.id;
  const companyId = req.user.companyId;

  if (!lat || !lng) {
    return res.json({ ok: false, error: "location_required" });
  }

  const locations = await Location.getByCompany(companyId);

  if (!locations || locations.length === 0) {
    return res.json({ ok: false, error: "no_locations_configured" });
  }

  let matchedLocation = null;
  let distance = null;

  for (const loc of locations) {
    const d = calculateDistance(lat, lng, loc.lat, loc.lng);
    if (d <= loc.radius) {
      matchedLocation = loc;
      distance = Math.round(d);
      break;
    }
  }

  if (!matchedLocation) {
    return res.json({ ok: false, error: "outside_all_locations" });
  }

  const attendance = await Attendance.get(uid, todayIST());

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
      locationId: matchedLocation.locationId,
      locationName: matchedLocation.name,
      distance,
    });

    res.json({ ok: true, locationName: matchedLocation.name });
  } catch (e) {
    console.error("CHECKOUT ERROR:", e);
    res.json({ ok: false, error: "already_checked_out" });
  }
};

// ─── ATTENDANCE DASHBOARD ────────────────────────────────
module.exports.getAttendanceReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const companyId = req.user.companyId;

    if (!startDate || !endDate) {
      return res.json({ ok: false, error: "startDate & endDate required" });
    }

    const start = startDate; // "2026-04-01"
    const end = endDate; // "2026-04-30"

    // ✅ GSI1 - DATE range scan
    const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
    const ddb = require("../config/dynamo");

    const result = await ddb.send(
      new ScanCommand({
        TableName: "abhinav_attendance",
        FilterExpression: "companyId = :cid AND GSI1PK BETWEEN :start AND :end",
        ExpressionAttributeValues: {
          ":cid": companyId,
          ":start": `DATE#${start}`,
          ":end": `DATE#${end}`,
        },
      }),
    );

    const records = result.Items || [];

    // ✅ Per user summary
    const userMap = {};

    records.forEach((r) => {
      const name = r.userName || "Unknown";
      const date = r.GSI1PK?.replace("DATE#", "") || "";

      if (!userMap[name]) {
        userMap[name] = {
          name,
          totalDays: 0,
          presentDays: [],
          records: [],
        };
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

    const attendanceReport = Object.values(userMap);

    res.json({
      ok: true,
      totalRecords: records.length,
      attendanceReport,
    });
  } catch (e) {
    console.error("ATTENDANCE REPORT ERROR:", e);
    res.json({ ok: false, error: e.message });
  }
};
