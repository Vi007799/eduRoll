"use strict";
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" } : undefined });
(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(sql);
    console.log("eduRoll database schema is up to date.");
  } finally { await pool.end(); }
})().catch(error => { console.error("Migration failed:", error.message); process.exit(1); });
