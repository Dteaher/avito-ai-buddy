import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import { createBuddy } from '../server/buddy.ts';
import { createStore } from '../server/store.ts';

const task = '/api/tasks/SEARCH-01';
const checks = [
  { id: 'without-city', expectedCities: ['kazan', 'samara'] },
  { id: 'kazan', expectedCities: ['kazan'] },
];

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return `http://127.0.0.1:${address.port}`;
}

describe('SEARCH-01 over HTTP', () => {
  let dir: string;
  let store: ReturnType<typeof createStore>;
  let server: Server;
  let base: string;
  let standBase: string;
  let cookie: string;

  async function start(env: NodeJS.ProcessEnv = {}) {
    store = createStore(join(dir, 'test.sqlite'));
    server = createServer(createApp({ store, standOrigin: () => standBase, buddy: createBuddy(env) }));
    base = await listen(server);
    standBase = base;
    const session = await fetch(`${base}/api/workspace`);
    cookie = session.headers.get('set-cookie')!.split(';')[0];
  }

  async function stop() {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }

  const get = (path: string, session = cookie) => fetch(`${base}${path}`, { headers: { cookie: session } });
  const post = (path: string, body?: unknown, session = cookie) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { cookie: session, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const run = (input = checks) => post(`${task}/runs`, { checks: input });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'buddy-test-'));
    await start();
  });

  afterEach(async () => {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the intentional stand defect and rejects unsupported filters', async () => {
    for (const suffix of ['', '?city=kazan']) {
      const response = await get(`/demo/search${suffix}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ items: [{ id: 'ad-101', city: 'kazan' }] });
    }
    expect((await get('/demo/search?city=samara')).status).toBe(400);
    expect((await get('/demo/search?city=kazan&limit=1')).status).toBe(400);
  });

  it('detects missing Samara at HTTP 200 and matches the control', async () => {
    const response = await run();
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.checks[0]).toMatchObject({ status: 200, matches: false, missing: ['samara'], followsRule: true });
    expect(result.checks[1]).toMatchObject({ status: 200, matches: true, missing: [], followsRule: true });
    expect(JSON.parse(result.checks[0].rawBody)).toEqual({ items: result.checks[0].items });
  });

  it('compares a custom expectation independently from the rule', async () => {
    const response = await run([
      { id: 'without-city', expectedCities: ['kazan'] },
      { id: 'kazan', expectedCities: [] },
    ]);
    const result = await response.json();
    expect(result.checks[0]).toMatchObject({ expectedCities: ['kazan'], matches: true, followsRule: false });
    expect(result.checks[1]).toMatchObject({ expectedCities: [], matches: false, extra: ['kazan'], followsRule: false });
  });

  it('rejects unknown checks, malformed expectations and client URLs', async () => {
    for (const invalid of [null, [], [checks[0], checks[0]], [checks[0], { ...checks[1], id: 'samara' }],
      [checks[0], { ...checks[1], expectedCities: ['kazan', 'kazan'] }],
      [checks[0], { ...checks[1], expectedCities: ['ufa'] }],
      [checks[0], { ...checks[1], url: 'http://example.com' }]]) {
      expect((await post(`${task}/runs`, { checks: invalid })).status).toBe(400);
    }
    expect((await post(`${task}/runs`, { checks, url: 'http://example.com' })).status).toBe(400);
  });

  it('checks the demo session and ownership of the task, run and record', async () => {
    expect((await post(`${task}/runs`, { checks }, '')).status).toBe(401);
    expect((await post(`${task}/runs`, { checks }, 'buddy_session=fake')).status).toBe(401);
    expect((await post('/api/tasks/OTHER/runs', { checks })).status).toBe(404);
    expect((await post(`${task}/runs/other/publication`)).status).toBe(404);
    expect((await get('/api/records/other')).status).toBe(404);
    expect((await get('/api/records/other', '')).status).toBe(401);
    const snapshot = await (await run()).json();
    expect(store.publish(snapshot.id, 'other-owner', 'SEARCH-01').record).toBeUndefined();
    const record = await (await post(`${task}/runs/${snapshot.id}/publication`)).json();
    expect(store.readRecord(record.id, 'other-owner', 'SEARCH-01')).toBeUndefined();
  });

  it('rejects cross-origin mutations and accepts the browser origin', async () => {
    const send = (origin: string, body: string) => fetch(`${base}${task}/runs`, {
      method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body,
    });
    expect((await send('http://localhost:9000', JSON.stringify({ checks }))).status).toBe(403);
    expect((await send(base, '{')).status).toBe(400);
    expect((await send(base, JSON.stringify({ checks }))).status).toBe(201);
  });

  it('persists the run snapshot and returns the same publication on concurrent retries and restart', async () => {
    const snapshot = await (await run()).json();
    const path = `${task}/runs/${snapshot.id}/publication`;
    expect((await post(path, undefined, '')).status).toBe(401);
    const responses = await Promise.all([post(path), post(path)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const [record, duplicate] = await Promise.all(responses.map((response) => response.json()));
    expect(record).toEqual(duplicate);
    expect(record).toMatchObject({ run: snapshot, url: `/records/${record.id}` });
    await stop();
    await start();
    expect(await (await get(`/api${record.url}`)).json()).toEqual(record);
    expect(await (await post(path)).json()).toEqual(record);
  });

  it('allows retry with the same expectations when the stand returns an error', async () => {
    const unavailable = createServer((_req, res) => res.writeHead(503).end('Unavailable'));
    standBase = await listen(unavailable);
    try {
      expect((await run()).status).toBe(502);
      standBase = base;
      expect((await run()).status).toBe(201);
    } finally {
      unavailable.close();
    }
  });

  it('grounds demo answers in the instruction and asks about ambiguous requests', async () => {
    for (const [question, fragment] of [
      ['Как проверить поиск без города?', 'Самара'],
      ['Как проверить фильтр по Казани?', 'city=kazan'],
      ['Ответа 200 достаточно?', 'содержимое'],
    ]) {
      const answer = await (await post(`${task}/buddy`, { question })).json();
      expect(answer).toMatchObject({ sourceId: 'search-guide-v1' });
      expect(answer.text).toMatch(new RegExp(fragment, 'i'));
    }
    const answer = await (await post(`${task}/buddy`, { question: 'Что делать?' })).json();
    expect(answer.text).toContain('Уточни');
    expect(answer.sourceId).toBeUndefined();
    expect((await post(`${task}/buddy`, { question: ' ' })).status).toBe(400);
  });

  it('uses the configured model transport with task context and handles provider failures', async () => {
    let received: { url?: string; authorization?: string; body?: string } = {};
    let modelAvailable = true;
    const provider = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      received = { url: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString() };
      res.writeHead(modelAvailable ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Проверь города в теле ответа.' } }] }));
    });
    const providerOrigin = await listen(provider);
    try {
      await stop();
      await start({ BUDDY_BASE_URL: `${providerOrigin}/v1/`, BUDDY_MODEL: 'fixture-model', BUDDY_API_KEY: 'fixture-key' });
      expect(await (await get('/api/workspace')).json()).toMatchObject({ buddyMode: 'model' });
      const question = 'Что проверить?';
      const response = await post(`${task}/buddy`, { question });
      expect(await response.json()).toEqual({ text: 'Проверь города в теле ответа.', sourceId: 'search-guide-v1' });
      expect(received).toMatchObject({ url: '/v1/chat/completions', authorization: 'Bearer fixture-key' });
      const payload = JSON.parse(received.body!);
      expect(payload).toMatchObject({ model: 'fixture-model', messages: [
        { role: 'system', content: expect.stringContaining('Задача SEARCH-01') }, { role: 'user', content: question },
      ] });
      expect(payload).not.toHaveProperty('tools');
      modelAvailable = false;
      expect((await post(`${task}/buddy`, { question })).status).toBe(502);
    } finally {
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
  });
});
