const jwt = require("jsonwebtoken");

exports.verifyMaster = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "No token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ FIXED CASE
    if (decoded.role !== "MASTER") {
      return res.status(403).json({ message: "Access denied. Master only." });
    }

    req.user = decoded;
    next();

  } catch (e) {
    return res.status(401).json({ message: "Invalid token" });
  }
};