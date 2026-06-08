import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id SERIAL PRIMARY KEY,
      entry_id VARCHAR(64) UNIQUE NOT NULL,
      session_id VARCHAR(64),
      time_str VARCHAR(16),
      matched BOOLEAN,
      score FLOAT,
      text TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS memos (
      id SERIAL PRIMARY KEY,
      source TEXT,
      ai_reply TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("[DB] Tables ready");
}

// Transcripts
export async function saveTranscript(entry: {
  entry_id: string; session_id?: string; time_str?: string;
  matched?: boolean; score?: number; text?: string;
}) {
  await pool.query(
    `INSERT INTO transcripts (entry_id, session_id, time_str, matched, score, text)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (entry_id) DO UPDATE SET matched=$4, score=$5, text=$6`,
    [entry.entry_id, entry.session_id, entry.time_str, entry.matched, entry.score, entry.text]
  );
}

export async function saveTranscripts(entries: Array<{
  entry_id: string; session_id?: string; time_str?: string;
  matched?: boolean; score?: number; text?: string;
}>) {
  if (entries.length === 0) return;
  for (const e of entries) await saveTranscript(e);
}

export async function listTranscripts(): Promise<Array<{
  entry_id: string; session_id: string; time_str: string;
  matched: boolean | null; score: number | null; text: string | null;
}>> {
  const res = await pool.query(
    `SELECT entry_id, session_id, time_str, matched, score, text
     FROM transcripts ORDER BY created_at DESC LIMIT 100`
  );
  return res.rows;
}

// Memos
export async function saveMemo(memo: { source?: string; ai_reply?: string }) {
  await pool.query(
    `INSERT INTO memos (source, ai_reply) VALUES ($1,$2)`,
    [memo.source, memo.ai_reply]
  );
}

export async function listMemos(): Promise<Array<{
  id: number; source: string; ai_reply: string; created_at: string;
}>> {
  const res = await pool.query(
    `SELECT id, source, ai_reply, created_at FROM memos ORDER BY created_at DESC LIMIT 100`
  );
  return res.rows;
}

export async function deleteMemo(id: number) {
  await pool.query(`DELETE FROM memos WHERE id = $1`, [id]);
}
