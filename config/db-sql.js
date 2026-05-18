const sql = require("mssql");

const config = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE || "master",
  port: Number(process.env.SQL_PORT || 1433),
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

async function connectSQL() {
  try {
    await sql.connect(config);
    console.log("SQL Server connected ✅");
  } catch (err) {
    console.error("SQL connection error ❌", err);
  }
}

module.exports = { sql, connectSQL };