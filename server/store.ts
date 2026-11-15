import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AttemptChoice, DemoIdentityId, Publication, Run, Task, TrackerDelivery } from '../shared/contracts.ts';

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
    CREATE TABLE IF NOT EXISTS assignments (
      task_id TEXT NOT NULL,
      trainee TEXT NOT NULL,
      mentor TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      PRIMARY KEY(task_id, trainee)
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      trainee TEXT NOT NULL,
      first TEXT,
      help TEXT NOT NULL DEFAULT 'none',
      state TEXT NOT NULL DEFAULT 'open',
      FOREIGN KEY(task_id, trainee) REFERENCES assignments(task_id, trainee)
    );
  `);
  db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
  try {
    const recordColumns = db.prepare('PRAGMA table_info(records)').all().map(({ name }) => name);
    if (!recordColumns.includes('previous_id')) {
      db.exec(`
        CREATE TABLE records_versioned (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id),
          published_at TEXT NOT NULL,
          conclusion TEXT NOT NULL DEFAULT '',
          previous_id TEXT UNIQUE REFERENCES records_versioned(id),
          canonical INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO records_versioned (id, run_id, published_at, conclusion)
        SELECT id, run_id, published_at, ${recordColumns.includes('conclusion') ? 'conclusion' : "''"} FROM records;
        DROP TABLE records;
        ALTER TABLE records_versioned RENAME TO records;
        CREATE UNIQUE INDEX records_canonical_by_run ON records (run_id) WHERE canonical = 1;
      `);
    }
    if (!db.prepare('PRAGMA table_info(record_replays)').all().some(({ name }) => name === 'actor')) {
      db.exec('ALTER TABLE record_replays ADD COLUMN actor TEXT');
    }
    if (!recordColumns.includes('tracker_status')) {
      db.exec('ALTER TABLE records ADD COLUMN tracker_status TEXT; ALTER TABLE records ADD COLUMN tracker_id TEXT');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }

  const insertRun = db.prepare('INSERT INTO runs (id, owner, task_id, snapshot) VALUES (?, ?, ?, ?)');
  const runById = db.prepare('SELECT snapshot FROM runs WHERE id = ? AND owner = ? AND task_id = ?');
  const insertRecord = db.prepare(`
    INSERT INTO records (id, run_id, published_at, conclusion, tracker_status)
    SELECT ?, id, ?, ?, ? FROM runs WHERE id = ? AND owner = ? AND task_id = ?
    ON CONFLICT(run_id) WHERE canonical = 1 DO NOTHING
  `);
  const recordQuery = `
    SELECT records.id, published_at, snapshot, conclusion, decision, comment, reviewed_at, previous_id, tracker_status, tracker_id
    FROM records JOIN runs ON runs.id = run_id LEFT JOIN reviews ON record_id = records.id
  `;
  const byRun = db.prepare(`${recordQuery} WHERE run_id = ? AND owner = ? AND task_id = ? AND canonical = 1`);
  const byId = db.prepare(`${recordQuery} WHERE records.id = ? AND owner = ?`);
  const nextVersion = db.prepare(`${recordQuery} WHERE previous_id = ? AND owner = ?`);
  const insertRevision = db.prepare(`
    INSERT INTO records (id, run_id, published_at, conclusion, previous_id, canonical, tracker_status)
    SELECT ?, id, ?, ?, ?, ?, ? FROM runs WHERE id = ? AND owner = ? AND task_id = ?
    ON CONFLICT DO NOTHING
  `);
  const completeDelivery = db.prepare(`
    UPDATE records SET tracker_status = ?, tracker_id = ? WHERE id = ? AND tracker_status = 'pending'
  `);
  const byOwner = db.prepare(`
    SELECT records.id, task_id, published_at, decision, previous_id,
      (SELECT next.id FROM records AS next WHERE next.previous_id = records.id) AS next_id
    FROM records
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
    INSERT INTO record_replays (record_id, run_id, actor) VALUES (?, ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET run_id = excluded.run_id, actor = excluded.actor
  `);
  const latestReplay = db.prepare(`
    SELECT snapshot, actor FROM record_replays JOIN runs ON runs.id = run_id WHERE record_id = ? AND owner = ?
  `);
  const assign = db.prepare('INSERT OR IGNORE INTO assignments (task_id, trainee, mentor, snapshot) VALUES (?, ?, ?, ?)');
  const assigned = db.prepare('SELECT snapshot FROM assignments WHERE task_id = ? AND trainee = ?');
  const openAttempt = db.prepare('INSERT INTO attempts (id, task_id, trainee) VALUES (?, ?, ?)');
  const attemptScope = 'id = ? AND task_id = ? AND trainee = ?';
  const attemptById = db.prepare(`SELECT first, help, state FROM attempts WHERE ${attemptScope}`);
  const writeFirst = db.prepare(`UPDATE attempts SET first = ? WHERE ${attemptScope} AND state = 'open' AND first IS NULL`);
  const markHelp = db.prepare(`UPDATE attempts SET help = CASE WHEN first IS NULL THEN 'before-choice' ELSE 'after-choice' END
    WHERE ${attemptScope} AND state = 'open' AND help = 'none'`);
  const lockAttempt = db.prepare(`UPDATE attempts SET state = 'running' WHERE ${attemptScope} AND state = 'open'
    RETURNING first, help`);
  const releaseAttempt = db.prepare(`UPDATE attempts SET state = 'open' WHERE ${attemptScope} AND state = 'running'`);
  const finishAttempt = db.prepare(`UPDATE attempts SET state = 'used' WHERE ${attemptScope} AND state = 'running'`);

  function read(row: ReturnType<typeof byId.get>): Publication | undefined {
    if (!row) return;
    const record: Publication = { id: String(row.id), url: `/records/${row.id}`, publishedAt: String(row.published_at),
      run: JSON.parse(String(row.snapshot)) as Run };
    if (row.conclusion) record.conclusion = String(row.conclusion);
    if (row.tracker_status === 'pending' || row.tracker_status === 'blocked') record.tracker = { status: row.tracker_status };
    if (row.tracker_status === 'delivered' && typeof row.tracker_id === 'string') {
      record.tracker = { status: 'delivered', id: row.tracker_id };
    }
    if (row.decision === 'accepted' || row.decision === 'returned') record.review = {
      decision: row.decision, comment: String(row.comment), reviewedAt: String(row.reviewed_at),
    };
    return record;
  }

  function readRecord(id: string, owner: string) {
    const row = byId.get(id, owner);
    const record = read(row);
    if (!record) return;
    const previous = typeof row?.previous_id === 'string' ? read(byId.get(row.previous_id, owner)) : undefined;
    if (previous) record.previous = { id: previous.id, runId: previous.run.id, conclusion: previous.conclusion, review: previous.review };
    const next = nextVersion.get(id, owner);
    if (next) record.nextId = String(next.id);
    return record;
  }

  return {
    assign(task: Task, trainee: DemoIdentityId, mentor: DemoIdentityId) {
      return assign.run(task.id, trainee, mentor, JSON.stringify(task)).changes === 1;
    },
    assignment(taskId: string, trainee: DemoIdentityId): Task | undefined {
      const row = assigned.get(taskId, trainee);
      return row ? JSON.parse(String(row.snapshot)) as Task : undefined;
    },
    openAttempt(taskId: string, trainee: DemoIdentityId) {
      const id = randomUUID();
      openAttempt.run(id, taskId, trainee);
      return id;
    },
    setFirstChoice(id: string, taskId: string, trainee: DemoIdentityId, choice: AttemptChoice) {
      const snapshot = JSON.stringify(choice);
      writeFirst.run(snapshot, id, taskId, trainee);
      const row = attemptById.get(id, taskId, trainee);
      return row?.state === 'open' && row.first === snapshot;
    },
    noteHelp(id: string, taskId: string, trainee: DemoIdentityId) {
      markHelp.run(id, taskId, trainee);
      return attemptById.get(id, taskId, trainee)?.state === 'open';
    },
    lockAttempt(id: string, taskId: string, trainee: DemoIdentityId) {
      const row = lockAttempt.get(id, taskId, trainee);
      return row ? { first: row.first ? JSON.parse(String(row.first)) as AttemptChoice : undefined,
        help: row.help as NonNullable<Run['attempt']>['help'] } : undefined;
    },
    releaseAttempt(id: string, taskId: string, trainee: DemoIdentityId) {
      releaseAttempt.run(id, taskId, trainee);
    },
    saveAttemptRun(id: string, run: Run, trainee: DemoIdentityId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        insertRun.run(run.id, trainee, run.task.id, JSON.stringify(run));
        finishAttempt.run(id, run.task.id, trainee);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    saveRun(run: Run, owner: string) {
      insertRun.run(run.id, owner, run.task.id, JSON.stringify(run));
    },
    readRun(id: string, owner: string, taskId: string): Run | undefined {
      const row = runById.get(id, owner, taskId);
      return row ? JSON.parse(String(row.snapshot)) as Run : undefined;
    },
    publish(runId: string, owner: string, taskId: string, conclusion = '', track = false) {
      const id = `QA-${randomUUID()}`;
      const { changes } = insertRecord.run(id, new Date().toISOString(), conclusion, track ? 'pending' : null, runId, owner, taskId);
      const saved = byRun.get(runId, owner, taskId);
      const record = saved ? readRecord(String(saved.id), owner) : undefined;
      return { record, created: changes === 1 };
    },
    readRecord,
    revise(previous: Publication, owner: string, runId: string, conclusion: string, track = false) {
      const id = `QA-${randomUUID()}`;
      const { changes } = insertRevision.run(id, new Date().toISOString(), conclusion, previous.id,
        Number(runId !== previous.run.id), track ? 'pending' : null, runId, owner, previous.run.task.id);
      const saved = nextVersion.get(previous.id, owner);
      const record = saved ? readRecord(String(saved.id), owner) : undefined;
      return { record: record?.run.id === runId && (record.conclusion ?? '') === conclusion ? record : undefined, created: changes === 1 };
    },
    completeTrackerDelivery(id: string, delivery: TrackerDelivery) {
      if (delivery.status !== 'pending') completeDelivery.run(delivery.status, delivery.status === 'delivered' ? delivery.id : null, id);
    },
    readReplay(id: string, owner: DemoIdentityId) {
      const row = latestReplay.get(id, owner);
      return row ? { replay: JSON.parse(String(row.snapshot)) as Run, replayBy: (row.actor || owner) as DemoIdentityId } : undefined;
    },
    saveReplay(id: string, run: Run, owner: string, actor: DemoIdentityId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        insertRun.run(run.id, owner, run.task.id, JSON.stringify(run));
        attachReplay.run(id, run.id, actor);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    recordsFor(owner: string) {
      return byOwner.all(owner).map((row) => ({
        id: row.id, taskId: row.task_id, publishedAt: row.published_at, decision: row.decision,
        previousId: row.previous_id || undefined, nextId: row.next_id || undefined,
      }));
    },
    reviewRecord(id: string, owner: string, decision: 'accepted' | 'returned', comment: string) {
      const { changes } = writeReview.run(decision, comment, new Date().toISOString(), id, owner);
      return { record: readRecord(id, owner), created: changes === 1 };
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
