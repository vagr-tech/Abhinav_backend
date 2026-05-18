const ddb = require("../config/dynamo");
const { ScanCommand } = require("@aws-sdk/lib-dynamodb");

const TABLE_NAME = "abhinav_visit_history";

exports.getHistory = async (req, res) => {
  try {
    let result;

    if (req.user.role === "salesman") {
      result = await ddb.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          FilterExpression: "pk = :pk",
          ExpressionAttributeValues: {
            ":pk": `VISIT#USER#${req.user.id}`,
          },
        }),
      );
    } else {
      // master / manager → see all
      result = await ddb.send(
        new ScanCommand({
          TableName: TABLE_NAME,
        }),
      );
    }

    const logs = result.Items || [];

    logs.sort((a, b) => new Date(b.createdAt).compareTo(new Date(a.createdAt)));

    res.json({
      success: true,
      logs,
    });
  } catch (e) {
    console.error("HISTORY ERROR:", e);
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
};
// ================= DASHBOARD REPORT =================
exports.getDashboardReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate & endDate required",
      });
    }

    const companyId = req.user.companyId;

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression:
          "companyId = :cid AND (attribute_not_exists(isDeleted) OR isDeleted <> :true)",
        ExpressionAttributeValues: {
          ":cid": companyId,
          ":true": true,
        },
      }),
    );

    let visits = result.Items || [];

    visits = visits.filter((v) => {
      if (!v.createdAt) return false;
      const visitDate = new Date(v.createdAt);
      return visitDate >= start && visitDate <= end;
    });

    // 🔥 Totals
    let totalVisits = 0;
    let totalCalls = 0;
    let totalMatch = 0;
    let totalMismatch = 0;
    let totalCallDuration = 0;

    const salesmanMap = {};

    visits.forEach((v) => {
      const name =
        v.salesmanName || v.createdByUserName || v.createdBy || "Unknown";

      const visitDate = new Date(v.createdAt);

      if (!salesmanMap[name]) {
        salesmanMap[name] = {
          name,
          visits: 0,
          calls: 0,
          match: 0,
          mismatch: 0,
          callDuration: 0,
          inTime: null,
          outTime: null,
        };
      }

      // intime
      if (
        !salesmanMap[name].inTime ||
        visitDate < new Date(salesmanMap[name].inTime)
      ) {
        salesmanMap[name].inTime = visitDate;
      }

      // outtime
      if (
        !salesmanMap[name].outTime ||
        visitDate > new Date(salesmanMap[name].outTime)
      ) {
        salesmanMap[name].outTime = visitDate;
      }

      const isCall = v.sk?.startsWith("CALL#");

      if (isCall) {
        totalCalls += 1;

        const duration = Number(v.durationSec || 0);

        totalCallDuration += duration;

        salesmanMap[name].calls += 1;
        salesmanMap[name].callDuration += duration;
      } else {
        totalVisits += 1;

        salesmanMap[name].visits += 1;

        const visitTime = new Date(v.createdAt);

        // First Visit
        if (
          !salesmanMap[name].firstVisitTime ||
          visitTime < new Date(salesmanMap[name].firstVisitTime)
        ) {
          salesmanMap[name].firstVisitTime = v.createdAt;
        }

        // Last Visit
        if (
          !salesmanMap[name].lastVisitTime ||
          visitTime > new Date(salesmanMap[name].lastVisitTime)
        ) {
          salesmanMap[name].lastVisitTime = v.createdAt;
        }

        if (v.result === "match") {
          totalMatch += 1;
          salesmanMap[name].match += 1;
        } else {
          totalMismatch += 1;
          salesmanMap[name].mismatch += 1;
        }
      }
    });

    const startStr = new Date(startDate).toISOString().split("T")[0];
    const endStr = new Date(endDate).toISOString().split("T")[0];

    const todayStr = new Date().toISOString().split("T")[0];

    const isToday = startStr === todayStr && endStr === todayStr;

    const sameDay = startStr === endStr;

    const showTime = isToday || sameDay;

    const salesmanPerformance = Object.values(salesmanMap).map((s) => ({
      ...s,
      inTime: showTime ? s.firstVisitTime : null,
      outTime: showTime ? s.lastVisitTime : null,
    }));

    res.json({
      success: true,
      totalVisits,
      totalCalls,
      totalCallDuration,
      totalMatch,
      totalMismatch,
      salesmanPerformance,
    });
  } catch (error) {
    console.error("DASHBOARD ERROR:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
