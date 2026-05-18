const router = require("express").Router();
const multer = require("multer");
const auth = require("../middleware/auth");
const csvController = require("../controllers/csvController");

// Multer - temp folder
const upload = multer({ dest: "uploads/csv_temp/" });

// MASTER - upload CSV
router.post("/upload", auth(["MASTER"]), upload.single("file"), csvController.uploadCSV);

// MASTER + DRIVER - get data
router.get("/data", auth(["MASTER", "DRIVER"]), csvController.getCSVData);

module.exports = router;