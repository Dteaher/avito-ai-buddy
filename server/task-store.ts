import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { DemoIdentityId, Task, TaskDraft, TaskDraftInput, TaskProject } from '../shared/contracts.ts';
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
  `);

  const insert = db.prepare('INSERT INTO authored_projects VALUES (?, ?, ?)');
  const projects = db.prepare('SELECT id, draft FROM authored_projects WHERE mentor = ? ORDER BY rowid DESC');
  const find = db.prepare('SELECT draft FROM authored_projects WHERE id = ? AND mentor = ?');
  const updateDraft = db.prepare('UPDATE authored_projects SET draft = ? WHERE id = ? AND mentor = ?');
  const versions = db.prepare(`
    SELECT v.input, v.snapshot, v.version, EXISTS(
      SELECT 1 FROM assignments WHERE task_id = v.task_id AND trainee = ?
    ) AS assigned
    FROM authored_versions v WHERE v.project_id = ? ORDER BY v.version DESC
  `);
  const addVersion = db.prepare('INSERT INTO authored_versions VALUES (?, ?, ?, ?, ?, ?)');
  const byRevision = db.prepare('SELECT snapshot FROM authored_versions WHERE project_id = ? AND draft_revision = ?');
  const byTask = db.prepare(`
    SELECT snapshot FROM authored_versions v JOIN authored_projects p ON p.id = v.project_id
    WHERE v.task_id = ? AND p.mentor = ?
  `);

  const draftFrom = (raw: unknown): TaskDraft | undefined => typeof raw === 'string' ? JSON.parse(raw) : undefined;
  const newDraft = (input: TaskDraftInput): TaskDraft => ({ input, revision: randomUUID() });
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
    list(mentor: DemoIdentityId, trainee: DemoIdentityId): TaskProject[] {
      return projects.all(mentor).map((row) => ({
        id: String(row.id), draft: draftFrom(row.draft),
        versions: versions.all(trainee, row.id).map((v) => ({
          version: Number(v.version), input: JSON.parse(String(v.input)), task: JSON.parse(String(v.snapshot)), assigned: Boolean(v.assigned),
        })),
      }));
    },
    create(mentor: DemoIdentityId, input: TaskDraftInput) {
      const id = `TASK-${randomUUID()}`;
      const draft = newDraft(input);
      insert.run(id, mentor, JSON.stringify(draft));
      return { id, draft, versions: [] };
    },
    save(id: string, mentor: DemoIdentityId, trainee: DemoIdentityId, input: TaskDraftInput, basedOn: string) {
      return inTransaction(() => {
        const row = find.get(id, mentor);
        if (!row) return;
        const current = draftFrom(row.draft);
        const latest = versions.get(trainee, id);
        if ((current?.revision ?? String(latest?.version)) !== basedOn) return null;
        const draft = newDraft(input);
        updateDraft.run(JSON.stringify(draft), id, mentor);
        return draft;
      });
    },
    publish(id: string, mentor: DemoIdentityId, trainee: DemoIdentityId, revision: string) {
      return inTransaction(() => {
        const row = find.get(id, mentor);
        if (!row) return;
        const previous = byRevision.get(id, revision);
        if (previous) return { created: false, task: JSON.parse(String(previous.snapshot)) as Task };
        const draft = draftFrom(row.draft);
        if (!draft || draft.revision !== revision) return null;
        if (!draft.input.title || !draft.input.description || !draft.input.criterion || !draft.input.checkIds.length) return 'incomplete' as const;
        const version = Number(versions.get(trainee, id)?.version ?? 0) + 1;
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
