const router = require("express").Router();
const userController = require("../controllers/userController");
const auth = require("../middleware/auth");

// REGISTER MASTER
router.post("/register-master", userController.registerMaster);

// LOGIN
router.post("/login", userController.login);

//List
router.get("/list", auth(["MASTER"]), userController.listUsers);

// ADD USER (MASTER only)
router.post("/add", auth(["MASTER"]), userController.addUser);

// GET USERS
router.get("/", auth(), userController.getAllUsers);

// UPDATE USER
router.put("/:id", auth(), userController.updateUser);

// DELETE USER
router.delete("/:id", auth(), userController.deleteUser);

module.exports = router;