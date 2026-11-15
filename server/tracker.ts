import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { authoredTaskId } from './task-catalog.ts';
import type { TrackerDelivery } from '../shared/contracts.ts';

const taskLinks = new Map([
  ['SEARCH-01', 'ENG-101'], ['SORT-01', 'ENG-102'], ['ARCHIVE-01', 'ENG-103'], ['ACTIVE-01', 'ENG-104'],
]);

const trackerTaskFor = (taskId: string) => taskLinks.get(taskId) ?? (authoredTaskId.test(taskId) ? 'ENG-AUTHORED' : undefined);

export interface TrackerEvidence {
  taskId: string;
  publicationId: string;
  runId: string;
  ruleId: string;
  ruleVersion: string;
  localEvidenceUrl: string;
  conclusion: string;
}

export type SendToTracker = (evidence: TrackerEvidence) => Promise<TrackerDelivery>;

function bearer(secret: string, task: string) {
  return `Bearer ${createHmac('sha256', secret).update(task).digest('hex')}`;
}

export function trackerConfig(env: NodeJS.ProcessEnv) {
  const port = Number(env.TRACKER_PORT ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TRACKER_PORT должен быть от 1 до 65535');
  return { port, origin: `http://127.0.0.1:${port}`, secret: env.TRACKER_SECRET || 'first-check-local-demo' };
}

export function createTrackerClient(origin: string, secret: string): SendToTracker {
  return async (evidence) => {
    const trackerTask = trackerTaskFor(evidence.taskId);
    if (!trackerTask) return { status: 'blocked' };
    try {
      const response = await fetch(`${origin}/v1/tasks/${trackerTask}/evidence`, {
        method: 'POST',
        headers: {
          authorization: bearer(secret, trackerTask),
          'content-type': 'application/json',
          'idempotency-key': `first-check/${evidence.publicationId}`,
        },
        body: JSON.stringify(evidence),
        redirect: 'error',
        signal: AbortSignal.timeout(1600),
      });
      if ([400, 403, 409].includes(response.status)) return { status: 'blocked' };
      if (response.status !== 201 && response.status !== 200) return { status: 'pending' };
      const receipt: unknown = await response.json();
      if (receipt && typeof receipt === 'object' && 'id' in receipt
        && typeof receipt.id === 'string' && /^TRK-[\w-]{1,40}$/.test(receipt.id)) return { status: 'delivered', id: receipt.id };
    } catch {
      // Keep the saved publication pending. The service may have committed before the response was lost.
    }
    return { status: 'pending' };
  };
}

function evidenceBody(input: Partial<TrackerEvidence> | undefined, trackerTask: string) {
  if (!input) return;
  const { taskId, publicationId, runId, ruleId, ruleVersion, localEvidenceUrl, conclusion } = input;
  if (typeof taskId !== 'string' || trackerTaskFor(taskId) !== trackerTask
    || typeof publicationId !== 'string' || !/^QA-[\w-]{1,40}$/.test(publicationId)
    || typeof runId !== 'string' || !runId || typeof ruleId !== 'string' || !ruleId
    || typeof ruleVersion !== 'string' || !ruleVersion || localEvidenceUrl !== `/records/${publicationId}`
    || typeof conclusion !== 'string' || conclusion.length > 1000) return;
  return { taskId, publicationId, runId, ruleId, ruleVersion, localEvidenceUrl, conclusion };
}

export function createTrackerService(path: string, secret: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 3000 });
  db.exec(`CREATE TABLE IF NOT EXISTS evidence (
    delivery_key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, task TEXT NOT NULL, body TEXT NOT NULL
  )`);
  const write = db.prepare('INSERT INTO evidence VALUES (?, ?, ?, ?) ON CONFLICT(delivery_key) DO NOTHING');
  const find = db.prepare('SELECT id, task, body FROM evidence WHERE delivery_key = ?');
  const app = express();
  app.disable('x-powered-by');
  app.post('/v1/tasks/:task/evidence', (req, res, next) => {
    const expected = Buffer.from(bearer(secret, req.params.task));
    const received = Buffer.from(req.get('authorization') ?? '');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      res.sendStatus(403);
      return;
    }
    next();
  }, express.json({ limit: '8kb' }), (req, res) => {
    const evidence = evidenceBody(req.body, req.params.task);
    const key = req.get('idempotency-key');
    if (!evidence || key !== `first-check/${evidence.publicationId}`) {
      res.sendStatus(400);
      return;
    }
    const body = JSON.stringify(evidence);
    const id = `TRK-${randomUUID()}`;
    const { changes } = write.run(key, id, req.params.task, body);
    const saved = find.get(key);
    if (saved?.task !== req.params.task || saved.body !== body) {
      res.sendStatus(409);
      return;
    }
    res.status(changes === 1 ? 201 : 200).json({ id: saved.id });
  });
  return { app, close: () => db.close() };
}
