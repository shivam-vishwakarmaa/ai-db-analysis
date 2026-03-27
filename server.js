const express = require("express");
const cors = require("cors");
const { Client } = require("pg");
const mysql = require("mysql2/promise");
const { MongoClient } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());

// Helper: extract schema from PostgreSQL
async function getPostgresSchema(connString) {
  const client = new Client({ connectionString: connString });
  await client.connect();
  try {
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tables = [];
    for (const row of tablesRes.rows) {
      const tableName = row.table_name;
      const columnsRes = await client.query(
        `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `,
        [tableName],
      );
      const columns = columnsRes.rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === "YES",
        primary_key: false, // need to check constraints; for simplicity, skip
        unique: false,
      }));
      // get sample data (first 5 rows)
      const sampleRes = await client.query(
        `SELECT * FROM "${tableName}" LIMIT 5`,
      );
      const sampleData = sampleRes.rows;
      const rowCountRes = await client.query(
        `SELECT COUNT(*) FROM "${tableName}"`,
      );
      const rowCount = parseInt(rowCountRes.rows[0].count, 10);
      tables.push({
        name: tableName,
        columns,
        primary_keys: [], // we can infer from constraints if needed
        foreign_keys: [], // same
        row_count: rowCount,
        sample_data: sampleData,
        indexes: [],
      });
    }
    return {
      metadata: {
        database_name: connString.split("/").pop(), // simple
        input_type: "postgres",
        total_tables: tables.length,
        total_columns: tables.reduce((s, t) => s + t.columns.length, 0),
        total_rows: tables.reduce((s, t) => s + t.row_count, 0),
        fk_source: "inferred",
      },
      tables,
      relationships: [], // you can later infer FKs from constraints
    };
  } finally {
    await client.end();
  }
}

// Similar for MySQL (simplified)
async function getMysqlSchema(connString) {
  const connection = await mysql.createConnection(connString);
  try {
    const [tables] = await connection.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = DATABASE()
    `);
    const tablesList = [];
    for (const t of tables) {
      const tableName = t.table_name;
      const [columns] = await connection.query(
        `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = ?
      `,
        [tableName],
      );
      const cols = columns.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === "YES",
        primary_key: false,
        unique: false,
      }));
      const [sample] = await connection.query(
        `SELECT * FROM \`${tableName}\` LIMIT 5`,
      );
      const [countRes] = await connection.query(
        `SELECT COUNT(*) as cnt FROM \`${tableName}\``,
      );
      const rowCount = countRes[0].cnt;
      tablesList.push({
        name: tableName,
        columns: cols,
        primary_keys: [],
        foreign_keys: [],
        row_count: rowCount,
        sample_data: sample,
        indexes: [],
      });
    }
    return {
      metadata: {
        database_name: connString.split("/").pop(),
        input_type: "mysql",
        total_tables: tablesList.length,
        total_columns: tablesList.reduce((s, t) => s + t.columns.length, 0),
        total_rows: tablesList.reduce((s, t) => s + t.row_count, 0),
        fk_source: "inferred",
      },
      tables: tablesList,
      relationships: [],
    };
  } finally {
    await connection.end();
  }
}

// MongoDB schema (collections)
async function getMongoSchema(connString) {
  const client = new MongoClient(connString);
  await client.connect();
  try {
    const db = client.db();
    const collections = await db.listCollections().toArray();
    const tables = [];
    for (const collInfo of collections) {
      const collName = collInfo.name;
      const sample = await db.collection(collName).find({}).limit(5).toArray();
      const count = await db.collection(collName).countDocuments();
      // Infer schema from first document or sample
      let columns = [];
      if (sample.length > 0) {
        const fields = new Set();
        sample.forEach((doc) => {
          Object.keys(doc).forEach((k) => fields.add(k));
        });
        columns = Array.from(fields).map((f) => ({
          name: f,
          type: "object", // simplistic
          nullable: true,
          primary_key: f === "_id",
          unique: false,
        }));
      }
      tables.push({
        name: collName,
        columns,
        primary_keys: columns.filter((c) => c.primary_key).map((c) => c.name),
        foreign_keys: [],
        row_count: count,
        sample_data: sample,
        indexes: [],
      });
    }
    return {
      metadata: {
        database_name: connString.split("/").pop(),
        input_type: "mongodb",
        total_tables: tables.length,
        total_columns: tables.reduce((s, t) => s + t.columns.length, 0),
        total_rows: tables.reduce((s, t) => s + t.row_count, 0),
        fk_source: "inferred",
      },
      tables,
      relationships: [],
    };
  } finally {
    await client.close();
  }
}

app.post("/api/connect", async (req, res) => {
  const { connectionString } = req.body;
  if (!connectionString) {
    return res.status(400).json({ error: "Missing connection string" });
  }
  try {
    let schema;
    if (connectionString.startsWith("postgresql://")) {
      schema = await getPostgresSchema(connectionString);
    } else if (connectionString.startsWith("mysql://")) {
      schema = await getMysqlSchema(connectionString);
    } else if (
      connectionString.startsWith("mongodb://") ||
      connectionString.startsWith("mongodb+srv://")
    ) {
      schema = await getMongoSchema(connectionString);
    } else {
      return res.status(400).json({ error: "Unsupported database type" });
    }
    res.json({ schema });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => console.log("API listening on 3001"));
