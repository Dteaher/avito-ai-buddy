import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AttemptChoice, DemoIdentityId, Task, TaskClarification, TaskDraft, TaskDraftInput, TaskParticipant, TaskProject } from '../shared/contracts.ts';
import { publishTask } from './task-catalog.ts';

export function createAuthoringStore(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authored_projects (
      id TEXT PRIMARY KEY, mentor TEXT NOT NULL, draft TEXT
    );
    CREATE TABLE IF NOT EXISTS authored_versions (
      project_id TEXT NOT NULL REFERENCES authored_projects(id),
      version INTEGER NOT NULL, task_id TEXT NOT NULL UNIQUE,
      draft_revision TEXT NOT NULL UNIQUE, input TEXT NOT NULL, snapshot TEXT NOT NULL,
      PRIMARY KEY(project_id, version)
    );
    CREATE TABLE IF NOT EXISTS authored_clarifications (
      task_id TEXT NOT NULL REFERENCES authored_versions(task_id),
      trainee TEXT NOT NULL,
      section TEXT NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY(task_id, trainee),
      FOREIGN KEY(task_id, trainee) REFERENCES assignments(task_id, trainee)
    );
    CREATE INDEX IF NOT EXISTS attempts_with_activity ON attempts(task_id, trainee) WHERE first IS NOT NULL OR state = 'used';
  `);

  const insert = db.prepare('INSERT INTO authored_projects VALUES (?, ?, ?)');
  const projects = db.prepare('SELECT id, draft FROM authored_projects WHERE mentor = ? ORDER BY rowid DESC');
  const find = db.prepare('SELECT draft FROM authored_projects WHERE id = ? AND mentor = ?');
  const updateDraft = db.prepare('UPDATE authored_projects SET draft = ? WHERE id = ? AND mentor = ?');
  const versions = db.prepare(`
    SELECT input, snapshot, version, task_id FROM authored_versions WHERE project_id = ? ORDER BY version DESC
  `);
  const addVersion = db.prepare('INSERT INTO authored_versions VALUES (?, ?, ?, ?, ?, ?)');
  const byRevision = db.prepare('SELECT snapshot FROM authored_versions WHERE project_id = ? AND draft_revision = ?');
  const byTask = db.prepare(`
    SELECT snapshot FROM authored_versions v JOIN authored_projects p ON p.id = v.project_id
    WHERE v.task_id = ? AND p.mentor = ?
  `);
  const findClarification = db.prepare('SELECT section, text FROM authored_clarifications WHERE task_id = ? AND trainee = ?');
  const assignmentActivity = db.prepare(`
    SELECT a.trainee, c.section, c.text, (c.task_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM attempts WHERE task_id = a.task_id AND trainee = a.trainee AND (first IS NOT NULL OR state = 'used')
    )) AS started, (
      SELECT first FROM attempts WHERE task_id = a.task_id AND trainee = a.trainee AND first IS NOT NULL ORDER BY rowid LIMIT 1
    ) AS first_choice
    FROM assignments a LEFT JOIN authored_clarifications c ON c.task_id = a.task_id AND c.trainee = a.trainee
    WHERE a.task_id = ? AND a.mentor = ? ORDER BY a.trainee
  `);
  const writeClarification = db.prepare(`
    INSERT INTO authored_clarifications (task_id, trainee, section, text) VALUES (?, ?, ?, ?)
    ON CONFLICT(task_id, trainee) DO UPDATE SET section = excluded.section, text = excluded.text
  `);

  const draftFrom = (raw: unknown): TaskDraft | undefined => typeof raw === 'string' ? JSON.parse(raw) : undefined;
  const newDraft = (input: TaskDraftInput): TaskDraft => ({ input, revision: randomUUID() });
  const noteFrom = (row?: { section?: unknown; text?: unknown }): TaskClarification | null => typeof row?.text === 'string'
    ? { section: row.section as TaskClarification['section'], text: row.text } : null;
  function clarification(taskId: string, trainee: DemoIdentityId): TaskClarification | null {
    return noteFrom(findClarification.get(taskId, trainee));
  }
  function participants(taskId: string, mentor: DemoIdentityId): TaskParticipant[] {
    return assignmentActivity.all(taskId, mentor).map((row) => ({ traineeId: row.trainee as DemoIdentityId,
      started: Boolean(row.started), clarification: noteFrom(row),
      firstChoice: typeof row.first_choice === 'string' ? JSON.parse(row.first_choice) as AttemptChoice : undefined }));
  }
  const inTransaction = <T>(operation: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  return {
    list(mentor: DemoIdentityId): TaskProject[] {
      return projects.all(mentor).map((row) => ({
        id: String(row.id), draft: draftFrom(row.draft),
        versions: versions.all(row.id).map((v) => ({ version: Number(v.version), input: JSON.parse(String(v.input)),
          task: JSON.parse(String(v.snapshot)), participants: participants(String(v.task_id), mentor) })),
      }));
    },
    clarification,
    participants,
    saveClarification(taskId: string, trainee: DemoIdentityId, note: TaskClarification) {
      writeClarification.run(taskId, trainee, note.section, note.text);
    },
    create(mentor: DemoIdentityId, input: TaskDraftInput) {
      const id = `TASK-${randomUUID()}`;
      const draft = newDraft(input);
      insert.run(id, mentor, JSON.stringify(draft));
      return { id, draft, versions: [] };
    },
    save(id: string, mentor: DemoIdentityId, input: TaskDraftInput, basedOn: string) {
      return inTransaction(() => {
        const row = find.get(id, mentor);
        if (!row) return;
        const current = draftFrom(row.draft);
        const latest = versions.get(id);
        if ((current?.revision ?? String(latest?.version)) !== basedOn) return null;
        const draft = newDraft(input);
        updateDraft.run(JSON.stringify(draft), id, mentor);
        return draft;
      });
    },
    publish(id: string, mentor: DemoIdentityId, revision: string) {
      return inTransaction(() => {
        const row = find.get(id, mentor);
        if (!row) return;
        const previous = byRevision.get(id, revision);
        if (previous) return { created: false, task: JSON.parse(String(previous.snapshot)) as Task };
        const draft = draftFrom(row.draft);
        if (!draft || draft.revision !== revision) return null;
        if (!draft.input.title || !draft.input.description || !draft.input.criterion || !draft.input.checkIds.length) return 'incomplete' as const;
        const version = Number(versions.get(id)?.version ?? 0) + 1;
        const task = publishTask(id, version, draft.input);
        addVersion.run(id, version, task.id, revision, JSON.stringify(draft.input), JSON.stringify(task));
        updateDraft.run(null, id, mentor);
        return { created: true, task };
      });
    },
    version(id: string, mentor: DemoIdentityId): Task | undefined {
      const row = byTask.get(id, mentor);
      return row ? JSON.parse(String(row.snapshot)) : undefined;
    },
  };
}
