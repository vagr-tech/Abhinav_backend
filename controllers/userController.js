const ddb = require("../config/dynamo");
const {
  ScanCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const USER_TABLE = "abhinav_users";
const COMPANY_TABLE = "abhinav_companies";


// =====================================================
// REGISTER MASTER + CREATE COMPANY
// =====================================================
exports.registerMaster = async (req, res) => {
  try {
    const { companyName, name, mobile, password } = req.body;

    if (!companyName || !name || !mobile || !password) {
      return res.status(400).json({ message: "All fields required" });
    }

    // 🔥 Auto Unique Company ID
    const companyId = "CMP" + Date.now();

    // 1️⃣ Create Company
    await ddb.send(
      new PutCommand({
        TableName: COMPANY_TABLE,
        Item: {
          pk: `COMPANY#${companyId}`,
          sk: "PROFILE",
          companyId,
          companyName,
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(companyId)",
      })
    );

    // 2️⃣ Create MASTER User
    const userId = uuidv4();

    const masterUser = {
      pk: `USER#${userId}`,
      sk: "PROFILE",

      user_id: userId,
      name,
      mobile,
      password,
      role: "MASTER",
      segment: "ALL",

      companyId,
      companyName,

      createdByUserId: userId,
      createdByUserName: name,

      createdAt: new Date().toISOString(),
    };

    await ddb.send(
      new PutCommand({
        TableName: USER_TABLE,
        Item: masterUser,
      })
    );

    res.json({
      success: true,
      message: "Company & Master created successfully",
      companyId,
    });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};


// =====================================================
// LOGIN
// =====================================================
exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    const result = await ddb.send(
      new ScanCommand({
        TableName: USER_TABLE,
        FilterExpression: "mobile = :m",
        ExpressionAttributeValues: {
          ":m": phone,
        },
      })
    );

    const user = result.Items?.[0];

    if (!user)
      return res.status(404).json({ message: "User not found" });

    if (user.password !== password)
      return res.status(400).json({ message: "Wrong password" });

    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: user.role,
        name: user.name,
        companyId: user.companyId,
        companyName: user.companyName,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ success: true, token, user });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};


// =====================================================
// ADD USER (MASTER ONLY)
// =====================================================
exports.addUser = async (req, res) => {
  try {
    console.log("🔥 ADD USER CONTROLLER HIT");

    if (!req.user) {
      console.log("❌ req.user is undefined");
      return res.status(500).json({ message: "req.user missing" });
    }

    console.log("👤 Logged in User Role:", req.user.role);

    if (req.user.role !== "MASTER") {
      console.log("❌ NOT MASTER");
      return res.status(403).json({
        message: "Only MASTER can create users",
      });
    }

    const { name, mobile, role, segment, password } = req.body;

    console.log("📦 Request Body:", req.body);

    const userId = require("uuid").v4();

    const newUser = {
      pk: `USER#${userId}`,
      sk: "PROFILE",

      user_id: userId,
      name,
      mobile,
      role,
      segment: segment || "",
      password,

      // ✅ MASTER company auto assign
      companyId: req.user.companyId,
      companyName: req.user.companyName,

      createdByUserId: req.user.user_id,
      createdByUserName: req.user.name,

      createdAt: new Date().toISOString(),
    };

    console.log("💾 BEFORE DB SAVE");

    await ddb.send(
      new (require("@aws-sdk/lib-dynamodb").PutCommand)({
        TableName: "abhinav_users",
        Item: newUser,
      })
    );

    console.log("✅ AFTER DB SAVE");

    res.json({ success: true, user: newUser });

  } catch (e) {
    console.error("🔥 ADD USER ERROR:", e);
    res.status(500).json({ error: e.message });
  }
};
// =====================================================
// GET USERS (Company Wise)
// =====================================================
exports.getAllUsers = async (req, res) => {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: USER_TABLE,
        FilterExpression: "companyId = :cid",
        ExpressionAttributeValues: {
          ":cid": req.user.companyId,
        },
      })
    );

    res.json({ success: true, users: result.Items || [] });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};


// =====================================================
// UPDATE USER
// =====================================================
exports.updateUser = async (req, res) => {
  try {
    const { name, mobile, role, segment, password } = req.body;

    await ddb.send(
      new UpdateCommand({
        TableName: USER_TABLE,
        Key: {
          pk: `USER#${req.params.id}`,
          sk: "PROFILE",
        },
        UpdateExpression:
          "SET #n = :name, mobile = :mobile, #r = :role, #s = :segment, password = :password",
        ExpressionAttributeNames: {
          "#n": "name",
          "#r": "role",
          "#s": "segment",
        },
        ExpressionAttributeValues: {
          ":name": name,
          ":mobile": mobile,
          ":role": role,
          ":segment": segment,
          ":password": password,
        },
      })
    );

    res.json({
      success: true,
      message: "User updated successfully",
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};


// =====================================================
// DELETE USER
// =====================================================
exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    await ddb.send(
      new DeleteCommand({
        TableName: USER_TABLE,
        Key: {
          pk: `USER#${userId}`,
          sk: "PROFILE",
        },
      })
    );

    res.json({
      success: true,
      message: "User deleted successfully",
      deletedUserId: userId,
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
//=========list user ===========//
exports.listUsers = async (req, res) => {
  try {

    const role = req.user.role.toLowerCase();

    let params = {
      TableName: "abhinav_users",
      FilterExpression: "#companyId = :cid",
      ExpressionAttributeNames: {
        "#companyId": "companyId",
      },
      ExpressionAttributeValues: {
        ":cid": req.user.companyId,
      },
    };

    // Manager → segment filter
    if (role === "manager") {
      params.FilterExpression += " AND #segment = :segment";
      params.ExpressionAttributeNames["#segment"] = "segment";
      params.ExpressionAttributeValues[":segment"] =
        req.user.segment;
    }

    // Salesman → not allowed
    if (role === "salesman") {
      return res.status(403).json({
        success: false,
        message: "Not allowed",
      });
    }

    const result = await ddb.send(new ScanCommand(params));

    res.json({
      success: true,
      users: result.Items || [],
    });

  } catch (err) {
    console.error("LIST USERS ERROR:", err);
    res.status(500).json({ success: false });
  }
};