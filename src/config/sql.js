const sql = require("mssql");

const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE || "master",
  port: Number(process.env.SQL_PORT || 1433),
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool;

async function getSqlPool() {
  try {
    if (pool) return pool;
    pool = await sql.connect(sqlConfig);
    console.log("SQL pool connected ✅");
    return pool;
  } catch (error) {
    console.error("SQL pool connection error ❌", error);
    throw error;
  }
}

module.exports = { sql, getSqlPool };