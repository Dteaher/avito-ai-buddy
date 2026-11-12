import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Publication, Run } from '../shared/contracts.ts';

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
  `);

  const insertRun = db.prepare('INSERT INTO runs (id, owner, task_id, snapshot) VALUES (?, ?, ?, ?)');
  const runById = db.prepare('SELECT snapshot FROM runs WHERE id = ? AND owner = ? AND task_id = ?');
  const insertRecord = db.prepare(`
    INSERT INTO records (id, run_id, published_at)
    SELECT ?, id, ? FROM runs WHERE id = ? AND owner = ? AND task_id = ?
    ON CONFLICT(run_id) DO NOTHING
  `);
  const byRun = db.prepare(`
    SELECT records.id, published_at, snapshot FROM records JOIN runs ON runs.id = run_id
    WHERE run_id = ? AND owner = ? AND task_id = ?
  `);
  const byId = db.prepare(`
    SELECT records.id, published_at, snapshot FROM records JOIN runs ON runs.id = run_id
    WHERE records.id = ? AND owner = ?
  `);

  function read(row: ReturnType<typeof byId.get>): Publication | undefined {
    if (!row) return;
    const { id, published_at, snapshot } = row as { id: string; published_at: string; snapshot: string };
    return { id, url: `/records/${id}`, publishedAt: published_at, run: JSON.parse(snapshot) as Run };
  }

  return {
    saveRun(run: Run, owner: string) {
      insertRun.run(run.id, owner, run.task.id, JSON.stringify(run));
    },
    readRun(id: string, owner: string, taskId: string): Run | undefined {
      const row = runById.get(id, owner, taskId);
      return row ? JSON.parse(String(row.snapshot)) as Run : undefined;
    },
    publish(runId: string, owner: string, taskId: string) {
      const id = `QA-${randomUUID()}`;
      const { changes } = insertRecord.run(id, new Date().toISOString(), runId, owner, taskId);
      const record = read(byRun.get(runId, owner, taskId));
      return { record, created: changes === 1 };
    },
    readRecord(id: string, owner: string) {
      return read(byId.get(id, owner));
    },
    close() { db.close(); },
  };
}
