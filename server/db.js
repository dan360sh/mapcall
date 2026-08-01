const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      avatar    TEXT,
      provider  TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('DB ready');
}

async function upsertUser({ id, name, avatar, provider }) {
  await pool.query(
    `INSERT INTO users (id, name, avatar, provider, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET name=$2, avatar=$3, updated_at=NOW()`,
    [id, name, avatar, provider]
  );
}

async function getUser(id) {
  const res = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
  return res.rows[0] ?? null;
}

module.exports = { initDb, upsertUser, getUser };
