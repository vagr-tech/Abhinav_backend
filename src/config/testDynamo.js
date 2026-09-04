const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const ddb = require("./dynamo");
const { ListTablesCommand } = require("@aws-sdk/client-dynamodb");

(async () => {
  try {
    const result = await ddb.send(new ListTablesCommand({}));
    console.log("Connected ✅ Tables:", result.TableNames);
  } catch (err) {
    console.error("Dynamo Error ❌", err);
  }
})();
