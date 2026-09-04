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
  checkoutLiveLocation,
} = require("../controllers/LivelocationController");

const auth = require("../middleware/auth");

router.post("/live-location", auth(["salesman"]), updateLiveLocation);
router.get(
  "/live-location",
  auth(["salesman", "manager", "master"]),
  getLiveLocations,
);
router.patch(
  "/live-location/checkout",
  auth(["salesman"]),
  checkoutLiveLocation,
); // ← NEW
// router.delete — remove பண்ணு

module.exports = router;
