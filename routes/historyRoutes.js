const router = require("express").Router();
const historyController = require("../controllers/historyController");
const auth = require("../middleware/auth");

// Master & Manager → see all
// Salesman → see own history only
router.get(
  "/list",
  auth(["master", "manager", "salesman"]),
  historyController.getHistory,
);

// Master & Manager
router.get(
  "/reports/dashboard",
  auth(["master", "manager"]),
  historyController.getDashboardReport,
);
module.exports = router;
