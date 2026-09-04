const router = require("express").Router();
const shopController = require("../controllers/shopController");
const auth = require("../middleware/auth");
const uploadShopImage = require("../middleware/uploadShopImage");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});
// ==============================
// ADD SHOP (salesman + manager)
// ==============================
router.post(
  "/add",
  auth(["salesman", "manager"]),
  uploadShopImage.single("shopImage"),
  shopController.addShop,
);

// ==============================
// BULK UPLOAD FROM EXCEL (manager + master)
// ==============================
router.post(
  "/bulk-excel-upload",
  auth(["master", "manager"]),
  upload.single("file"),
  shopController.bulkUploadFromExcel,
);
// ==============================
// LIST SHOPS
// ==============================
router.get(
  "/list",
  auth(["master", "manager", "salesman"]),
  shopController.listShops,
);

// ==============================
// APPROVE SHOP
// ==============================
router.put(
  "/approve/:id",
  auth(["master", "manager"]),
  shopController.approveShop,
);

// ==============================
// UPDATE SHOP
// ==============================
router.put(
  "/update/:id",
  auth(["master", "manager"]),
  shopController.updateShop,
);

// ==============================
// DELETE SHOP
// ==============================
router.delete(
  "/delete/:id",
  auth(["master", "manager"]),
  shopController.softDeleteShop,
);

// ==============================
// IMAGE UPDATE
// ==============================
router.put(
  "/update-image/:id",
  auth(["salesman"]), // 🔥 only salesman
  shopController.updateShopImage,
);

router.get(
  "/gst-lookup/:gstNumber",
  auth(["master", "manager", "salesman"]),
  shopController.getShopByGst,
);

// ==============================
// ADD CALL LOG (TEST PURPOSE)
// ==============================
router.post(
  "/:shopId/add-call",
  auth(["salesman", "manager"]),
  shopController.addCallLog,
);

// ==============================
// GET OWNER CALL DURATION
// ==============================
router.get(
  "/:shopId/owner-call-duration",
  auth(["master", "manager", "salesman"]),
  shopController.getOwnerCallDuration,
);

// ==============================
// ADD CALL LOG BY PHONE
// ==============================
router.post(
  "/calls",
  auth(["salesman", "manager"]),
  shopController.addCallLogByPhone,
);

module.exports = router;
