import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createBuddy } from '../server/buddy.ts';
import { activeFilterTask } from '../server/archive-scenario.ts';
import { sortTask } from '../server/price-scenario.ts';
import { task } from '../server/scenario.ts';

describe('Structured Buddy workflow', () => {
  it('keeps the price-less item in the draft and cites the instruction', async () => {
    const buddy = createBuddy({});
    const answer = await buddy.answer(sortTask, {
      intent: 'plan', question: 'Проверю, что 500 ₽ идёт перед 900 ₽. Карточки без цены можно исключить.',
    });
    expect(answer).toMatchObject({
      kind: 'draft', sources: [{ instructionId: 'sort-guide-v1', ruleNumber: 2 }],
      draft: { checkId: 'price-asc', checks: [{ id: 'price-asc', expectedOrder: ['ad-201', 'ad-202', 'ad-203'] }] },
    });
  });

  it('clarifies which search was used and remembers the answer within the same identity', async () => {
    const buddy = createBuddy({});
    const ask = (question: string, owner: string, clarificationId?: string) => buddy.answer(task, {
      question, intent: 'plan', clarificationId,
    }, undefined, undefined, owner);
    const opening = await ask('Пришла Казань, думаю, этого достаточно', 'a');
    expect(opening.kind).toBe('clarification');
    expect(opening.clarificationId).toBeTruthy();
    expect((await ask('Нет', 'b', opening.clarificationId)).kind).toBe('clarification');
    expect(await ask('Нет', 'a', opening.clarificationId)).toMatchObject({
      kind: 'draft', draft: { checkId: 'without-city', checks: [
        { id: 'without-city', expectedCities: ['kazan', 'samara'] }, { id: 'kazan', expectedCities: ['kazan'] },
      ] },
    });
    expect(await ask('Указал фильтр по Казани', 'a')).toMatchObject({ draft: { checkId: 'kazan' } });
  });

  it('validates the HTTP model draft, retries only once and never trusts model URLs', async () => {
    const correct = { kind: 'draft', text: 'Карточка без цены остаётся последней.',
      sources: ['rule:2'], checkId: 'price-asc', expected: ['ad-201', 'ad-202', 'ad-203'] };
    const invalid = [
      { ...correct, checkId: 'kazan' },
      { ...correct, expected: ['ad-201', 'ad-201', 'ad-203'] },
      { ...correct, expected: ['ad-203', 'ad-201', 'ad-202'] },
      { ...correct, sources: ['rule:99'] },
      { ...correct, path: 'https://malicious.invalid' },
      { ...correct, text: 'Я опубликовал результат.' },
    ];
    let replies: unknown[];
    let received = 0;
    const provider = createServer((_req, res) => {
      received++;
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] }));
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    try {
      const address = provider.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP address');
      const buddy = createBuddy({ BUDDY_BASE_URL: `http://127.0.0.1:${address.port}`, BUDDY_MODEL: 'fixture-model' });
      const ask = () => buddy.answer(sortTask, { intent: 'plan', question: 'Сравню только 500 и 900.' });
      for (const malformed of invalid) {
        replies = [malformed, correct];
        const before = received;
        const answer = await ask();
        expect(answer).toMatchObject({ mode: 'model', kind: 'draft', draft: { path: '/demo/search?sort=price_asc' } });
        expect(received - before).toBe(2);
      }
      replies = [invalid[0], invalid[1], correct];
      const before = received;
      expect(await ask()).toMatchObject({ mode: 'guide-fallback', kind: 'draft', fallbackReason: 'invalid-response' });
      expect(received - before).toBe(2);
    } finally {
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
  });

  it('constrains the provider to the known diagnostic check and its expected group', async () => {
    let properties: unknown;
    const provider = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      properties = JSON.parse(Buffer.concat(chunks).toString()).response_format.json_schema.schema.properties;
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        kind: 'draft', text: 'Проверь фильтр по активным.', sources: [], checkId: 'active-only', expected: ['active'],
      }) } }] }));
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    try {
      const address = provider.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP address');
      const buddy = createBuddy({ BUDDY_BASE_URL: `http://127.0.0.1:${address.port}`, BUDDY_MODEL: 'fixture-model' });
      const answer = await buddy.answer(activeFilterTask, { intent: 'plan', question: 'Достаточно проверить общую выдачу?' });
      expect(answer).toMatchObject({ mode: 'model', draft: { checkId: 'active-only' } });
      expect(properties).toMatchObject({ checkId: { enum: ['active-only'] },
        expected: { minItems: 1, maxItems: 1, items: { enum: ['active'] } } });
    } finally {
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
  });
});
