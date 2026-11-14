import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DemoIdentityId, Publication, Run } from '../shared/contracts.ts';

export function createStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 3000 });
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      task_id TEXT NOT NULL,
      snapshot TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
      published_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      identity TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      record_id TEXT PRIMARY KEY REFERENCES records(id),
      decision TEXT NOT NULL,
      comment TEXT NOT NULL,
      reviewed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS record_replays (
      record_id TEXT PRIMARY KEY REFERENCES records(id),
      run_id TEXT NOT NULL REFERENCES runs(id)
    );
  `);
  if (!db.prepare('PRAGMA table_info(records)').all().some(({ name }) => name === 'conclusion')) {
    db.exec("ALTER TABLE records ADD COLUMN conclusion TEXT NOT NULL DEFAULT ''");
  }

  const insertRun = db.prepare('INSERT INTO runs (id, owner, task_id, snapshot) VALUES (?, ?, ?, ?)');
  const runById = db.prepare('SELECT snapshot FROM runs WHERE id = ? AND owner = ? AND task_id = ?');
  const insertRecord = db.prepare(`
    INSERT INTO records (id, run_id, published_at, conclusion)
    SELECT ?, id, ?, ? FROM runs WHERE id = ? AND owner = ? AND task_id = ?
    ON CONFLICT(run_id) DO NOTHING
  `);
  const recordQuery = `
    SELECT records.id, published_at, snapshot, conclusion, decision, comment, reviewed_at
    FROM records JOIN runs ON runs.id = run_id LEFT JOIN reviews ON record_id = records.id
  `;
  const byRun = db.prepare(`${recordQuery} WHERE run_id = ? AND owner = ? AND task_id = ?`);
  const byId = db.prepare(`${recordQuery} WHERE records.id = ? AND owner = ?`);
  const byOwner = db.prepare(`
    SELECT records.id, task_id, published_at, decision FROM records
    JOIN runs ON runs.id = run_id LEFT JOIN reviews ON record_id = records.id
    WHERE owner = ? ORDER BY published_at DESC, records.id LIMIT 50
  `);
  const writeReview = db.prepare(`
    INSERT INTO reviews (record_id, decision, comment, reviewed_at)
    SELECT records.id, ?, ?, ? FROM records JOIN runs ON runs.id = run_id
    WHERE records.id = ? AND owner = ? ON CONFLICT(record_id) DO NOTHING
  `);
  const newSession = db.prepare('INSERT INTO sessions (token, identity, expires_at) VALUES (?, ?, ?)');
  const sessionByToken = db.prepare('SELECT identity FROM sessions WHERE token = ? AND expires_at > ?');
  const expireSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const removeSession = db.prepare('DELETE FROM sessions WHERE token = ?');
  const attachReplay = db.prepare(`
    INSERT INTO record_replays (record_id, run_id) VALUES (?, ?)
    ON CONFLICT(record_id) DO UPDATE SET run_id = excluded.run_id
  `);
  const latestReplay = db.prepare(`
    SELECT snapshot FROM record_replays JOIN runs ON runs.id = run_id WHERE record_id = ? AND owner = ?
  `);

  function read(row: ReturnType<typeof byId.get>): Publication | undefined {
    if (!row) return;
    const record: Publication = { id: String(row.id), url: `/records/${row.id}`, publishedAt: String(row.published_at),
      run: JSON.parse(String(row.snapshot)) as Run };
    if (row.conclusion) record.conclusion = String(row.conclusion);
    if (row.decision === 'accepted' || row.decision === 'returned') record.review = {
      decision: row.decision, comment: String(row.comment), reviewedAt: String(row.reviewed_at),
    };
    return record;
  }

  return {
    saveRun(run: Run, owner: string) {
      insertRun.run(run.id, owner, run.task.id, JSON.stringify(run));
    },
    readRun(id: string, owner: string, taskId: string): Run | undefined {
      const row = runById.get(id, owner, taskId);
      return row ? JSON.parse(String(row.snapshot)) as Run : undefined;
    },
    publish(runId: string, owner: string, taskId: string, conclusion = '') {
      const id = `QA-${randomUUID()}`;
      const { changes } = insertRecord.run(id, new Date().toISOString(), conclusion, runId, owner, taskId);
      const record = read(byRun.get(runId, owner, taskId));
      return { record, created: changes === 1 };
    },
    readRecord(id: string, owner: string) {
      return read(byId.get(id, owner));
    },
    readReplay(id: string, owner: string): Run | undefined {
      const row = latestReplay.get(id, owner);
      return row ? JSON.parse(String(row.snapshot)) as Run : undefined;
    },
    saveReplay(id: string, run: Run, owner: string) {
      db.exec('BEGIN IMMEDIATE');
      try {
        insertRun.run(run.id, owner, run.task.id, JSON.stringify(run));
        attachReplay.run(id, run.id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    recordsFor(owner: string) {
      return byOwner.all(owner).map((row) => ({
        id: row.id, taskId: row.task_id, publishedAt: row.published_at, decision: row.decision,
      }));
    },
    reviewRecord(id: string, owner: string, decision: 'accepted' | 'returned', comment: string) {
      const { changes } = writeReview.run(decision, comment, new Date().toISOString(), id, owner);
      return { record: read(byId.get(id, owner)), created: changes === 1 };
    },
    issueSession(token: string, identity: DemoIdentityId, expiresAt: number, previous?: string) {
      expireSessions.run(Date.now());
      if (previous) removeSession.run(previous);
      newSession.run(token, identity, expiresAt);
    },
    readSession(token: string) {
      return sessionByToken.get(token, Date.now())?.identity;
    },
    close() { db.close(); },
  };
}
