const jwt = require("jsonwebtoken");
const ddb = require("../config/dynamo");
const { GetCommand } = require("@aws-sdk/lib-dynamodb");

module.exports = (allowedRoles = []) => {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization || "";

      const token = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : null;

      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // ✅ Get user from DynamoDB
      const result = await ddb.send(
        new GetCommand({
          TableName: "abhinav_users",
          Key: {
            pk: `USER#${decoded.user_id}`,
            sk: "PROFILE",
          },
        })
      );

      const user = result.Item;

      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      // ✅ Role Check (case insensitive)
const userRole = (user.role || "").toLowerCase();
const allowed = allowedRoles.map(r => r.toLowerCase());

// ✅ CHANGE TO - allowedRoles empty a irundha anyone pass aaganum
if (allowed.length > 0 && !allowed.includes(userRole)) {
  return res.status(403).json({
    message: "Forbidden: Insufficient permissions",
  });
}

      // ✅ Attach FULL user info to request
      req.user = {
        id: user.user_id,
        name: user.name,
        role: user.role,
        segment: user.segment || "",
        mobile: user.mobile || "",

        // 🔥 IMPORTANT (for company filtering)
        companyId: user.companyId,
        companyName: user.companyName,
      };

      next();
    } catch (error) {
      console.error("AUTH ERROR:", error);
      return res.status(401).json({
        message: "Invalid token",
        error: error.message,
      });
    }
  };
};