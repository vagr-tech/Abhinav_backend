const router = require("express").Router();
const auth = require("../middleware/auth");
const ctrl = require("../controllers/visitController");

// SAVE VISIT
router.post("/save", auth(["salesman", "driver"]), ctrl.saveVisit);

// LIST VISITS
router.get("/list", auth(["master", "manager", "salesman"]), ctrl.getVisits);

router.delete("/delete", auth(["master", "manager"]), ctrl.deleteVisit);

router.get(
  "/history",
  auth(["master", "manager", "salesman", "driver"]),
  ctrl.getCallHistory,
);
module.exports = router;
