const ddb = require("../config/dynamo");
const { PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const CSV_TABLE = "abhinav_shops";

// =====================================================
// UPLOAD CSV - MASTER only
// =====================================================
exports.uploadCSV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "CSV file illai" });
    }

    const fs = require("fs");
    const { parse } = require("csv-parse/sync");

    const fileContent = fs.readFileSync(req.file.path, "utf8");
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    for (let i = 0; i < records.length; i++) {
      await ddb.send(new PutCommand({
        TableName: CSV_TABLE,
        Item: {
          pk: `SHOP#${req.user.companyId}_${Date.now()}_${i}`,
          sk: "PROFILE",
          companyId: req.user.companyId,
          ...records[i],
        },
      }));
    }

    fs.unlinkSync(req.file.path);

    res.json({ success: true, message: `${records.length} rows uploaded` });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

// =====================================================
// GET CSV DATA - MASTER + DRIVER
// =====================================================
exports.getCSVData = async (req, res) => {
  try {
    const result = await ddb.send(new ScanCommand({
      TableName: CSV_TABLE,
      FilterExpression: "companyId = :cid",
      ExpressionAttributeValues: {
        ":cid": req.user.companyId,
      },
    }));

    res.json({
      success: true,
      role: req.user.role,
      count: result.Count,
      data: result.Items || [],
    });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};