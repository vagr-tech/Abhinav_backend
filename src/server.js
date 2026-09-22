const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
require("../zohoCacheJob");
const { startShopSyncCron } = require("../syncShopDetailsFromZoho");
const express = require("express");
const cors = require("cors");
const cron = require("node-cron"); // ✅ ADD
const { syncZohoCustomers } = require("./services/zohoService"); // ✅ ADD
// ✅ ADD THIS
const { sql, connectSQL } = require("./config/db-sql");
// ROUTES
const userRoutes = require("./routes/userRoutes");
const shopRoutes = require("./routes/shopRoutes");

const historyRoutes = require("./routes/historyRoutes");
const visitRoutes = require("./routes/visitRoutes");
const zohoRoutes = require("./routes/zohoRoutes");
const pendingRoutes = require("./routes/pendingRoutes");

const attendanceRoutes = require("./routes/attendanceRoutes");
const locationRoutes = require("./routes/locationRoutes");
const liveRoutes = require("./routes/LiveloactionRoutes");

const app = express();
// =======================
// MIDDLEWARE
// =======================
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/api/test-sql", async (req, res) => {
  try {
    const result = await sql.query("SELECT GETDATE() AS time");
    res.json({
      success: true,
      data: result.recordset,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});
// =======================
// STATIC FILES (🔥 VERY IMPORTANT)
// =======================
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// =======================
// ROUTES (⚠️ ALL BEFORE listen)
// =======================
app.use("/api/users", userRoutes);
app.use("/api/shops", shopRoutes);

app.use("/api/zoho", zohoRoutes);

app.use("/api/history", historyRoutes);
app.use("/api/pending", pendingRoutes);
app.use("/api/visits", visitRoutes);

app.use("/api/attendance", attendanceRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api", liveRoutes);

// =======================
// DEFAULT ROUTE
// =======================
app.get("/", (req, res) => {
  res.send("Backend Running Successfully!");
});

// =======================
// TEST ROUTE (KEEP AS IS)
// =======================
app.get("/api/assign/test", (req, res) => {
  res.json({ success: true, message: "ASSIGN ROUTE WORKING" });
});

// Existing routes ellam same ah irukattum...
const csvRoutes = require("./routes/csvRoutes"); // ← ADD

// Existing app.use lines ellam same...
app.use("/api/csv", csvRoutes); // ← ADD

// =======================
// SERVER START (🔥 MUST BE LAST)
// =======================
const PORT = process.env.PORT;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startShopSyncCron();

  // ✅ Zoho Customer Sync — Daily 6:00 AM IST
  // Zoho-ல் புதுசா add / update ஆன customers → zoho_customers table-ல் reflect ஆகும்
  // cron format: second(opt) minute hour day month weekday
  cron.schedule(
    "0 0 6 * * *", // every day at 06:00:00
    async () => {
      console.log("⏰ [CRON] Zoho customer sync starting...");
      try {
        const result = await syncZohoCustomers();
        console.log(
          `✅ [CRON] Zoho sync done — added: ${result.added}, updated: ${result.updated}, errors: ${result.errors.length}`,
        );
      } catch (err) {
        console.error("❌ [CRON] Zoho sync failed:", err.message);
      }
    },
    { timezone: "Asia/Kolkata" }, // IST
  );
  console.log("⏰ Zoho customer sync cron scheduled — daily 6:00 AM IST");
});
