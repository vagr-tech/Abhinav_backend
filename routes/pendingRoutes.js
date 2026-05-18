const router = require("express").Router();
const auth = require("../middleware/auth");
const ctrl = require("../controllers/pendingController");

// SALESMAN
router.post("/add", auth(["salesman"]), ctrl.add);

// MANAGER / MASTER
router.get("/list", auth(["manager", "master"]), ctrl.listPending);
router.post("/approve/:id", auth(["manager", "master"]), ctrl.approve);
router.post("/reject/:id", auth(["manager", "master"]), ctrl.rejectShop);

module.exports = router;
