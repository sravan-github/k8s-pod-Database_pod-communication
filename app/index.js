'use strict';

const express = require('express');
const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Database connection pool
// All connection details come from environment variables injected by
// the Kubernetes Secret (see k8s/app-deployment.yaml).
// ---------------------------------------------------------------------------
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'appdb',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgrespassword',
  // Retry logic: keep retrying until the DB pod is ready
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis:       30000,
  max:                     10,
});

// ---------------------------------------------------------------------------
// Bootstrap: create the demo table if it does not exist
// ---------------------------------------------------------------------------
async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id        SERIAL PRIMARY KEY,
        content   TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('Database initialised successfully.');
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Express application
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// Health-check — used by Kubernetes readiness / liveness probes
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// GET /messages — list all messages
app.get('/messages', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM messages ORDER BY created_at DESC'
    );
    res.json({ messages: result.rows });
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// POST /messages — insert a new message
app.post('/messages', async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: '"content" string is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO messages (content) VALUES ($1) RETURNING *',
      [content]
    );
    res.status(201).json({ message: result.rows[0] });
  } catch (err) {
    console.error('Insert error:', err.message);
    res.status(500).json({ error: 'Database insert failed' });
  }
});

// DELETE /messages/:id — delete a message by id
app.delete('/messages/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const result = await pool.query(
      'DELETE FROM messages WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ error: 'Database delete failed' });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3000', 10);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      console.log(`Connected to PostgreSQL at ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err.message);
    process.exit(1);
  });
