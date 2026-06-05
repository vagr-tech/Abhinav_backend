// liveLocation.routes.js
// Add this to your main app.js / index.js:
//   const liveRoutes = require("./routes/liveLocation.routes");
//   app.use("/api", liveRoutes);

const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth"); // your existing auth middleware
const {
  updateLiveLocation,
  getLiveLocations,
  clearLiveLocation,
} = require("../controllers/LivelocationController");
const auth = require("../middleware/auth");

// Salesman → POST every 1 minute
router.post("/live-location", auth(["salesman"]), updateLiveLocation);

// Salesman + Manager + Master → GET
router.get(
  "/live-location",
  auth(["salesman", "manager", "master"]),
  getLiveLocations,
);

// Salesman → DELETE on logout
router.delete("/live-location", auth(["salesman"]), clearLiveLocation);

module.exports = router;
