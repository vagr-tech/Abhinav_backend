const router = require("express").Router();
const auth = require("../middleware/auth");
const ctrl = require("../controllers/locationController");

router.post("/create", auth(["master"]), ctrl.createLocations); // புதுசா create
router.post("/add", auth(["master"]), ctrl.addLocation); // ஒரு location add
router.get("/", auth(["master"]), ctrl.getLocations); // all locations get

module.exports = router;
