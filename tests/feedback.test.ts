import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guideFeedback, guidePlan } from '../server/buddy-workflow.ts';
import { executePriceRun, priceItems, ruleOrder, sortTask } from '../server/price-scenario.ts';
import { executeRun, listings, ruleCities } from '../server/scenario.ts';
import type { Run } from '../shared/contracts.ts';

let fixed = false;
const server = createServer((req, res) => {
  const items = req.url?.includes('price_asc')
    ? priceItems.toSorted((a, b) => (a.price ?? (fixed ? Infinity : -Infinity)) - (b.price ?? (fixed ? Infinity : -Infinity)))
    : fixed && !req.url?.includes('city=kazan') ? listings : listings.slice(0, 1);
  res.end(JSON.stringify({ items }));
});
let sortFixed: Run, sortBroken: Run, searchFixed: Run, searchBroken: Run;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const origin = `http://127.0.0.1:${address.port}`;
  const search = (fixed: boolean) => executeRun(origin, [
    { id: 'without-city', expectedCities: fixed ? ruleCities['without-city'] : ['kazan'] },
    { id: 'kazan', expectedCities: ['kazan'] },
  ]);
  [sortBroken, searchBroken] = await Promise.all([
    executePriceRun(origin, ruleOrder), search(true),
  ]);
  fixed = true;
  [sortFixed, searchFixed] = await Promise.all([executePriceRun(origin, ruleOrder), search(true)]);
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('Review of conclusions against real snapshots', () => {
  it('reports evidence for doubt without attributing an assertion', () => {
    const answer = guideFeedback(sortFixed, 'не могу сказать, что карточка без цены пропала', ['null-missing']);
    expect(answer.verdicts?.map(({ status }) => status)).not.toContain('refuted');
    expect(answer.text).toMatch(/присутствует.*3/i);
  });
  it.each([
    'Пока не уверен, есть ли она в выдаче',
    'Карточка без цены пропала?',
    'Если она пропала, может быть, её отсеял фильтр?',
    'Коллега написал, что карточка пропала. Я хочу проверить.',
    '«Карточка без цены пропала», — написал коллега.',
    'Не берусь утверждать, что карточку без ценника потеряли.',
  ])('shows observations rather than scoring %s', (question) => {
    const answer = guideFeedback(sortFixed, question.toLowerCase(), ['null-missing', 'sort-correct']);
    expect(answer.verdicts?.map(({ status }) => status)).toEqual(['observation']);
    expect(answer.text).toMatch(/присутствует.*3/i);
    expect(answer.sources).toContainEqual(expect.objectContaining({ runId: sortFixed.id, checkId: 'price-asc' }));
  });
  it('evaluates the asserted clause after a qualified one', () => {
    const answer = guideFeedback(sortFixed, 'не могу сказать, что карточка без цены пропала, но числовые цены возрастают',
      ['null-missing', 'not-numeric-ascending', 'sort-correct']);
    expect(answer.verdicts?.map(({ status }) => status)).toEqual(['confirmed', 'observation']);
    expect(answer.text).toMatch(/числовые цены действительно возрастают/i);
  });
  it('keeps doubt and control observations scoped in SEARCH-01', () => {
    const answer = guideFeedback(searchFixed, 'не уверен, что самара пропала без фильтра. в контроле самары нет.',
      ['main-missing-samara', 'not-control-correct']);
    expect(answer.verdicts?.map(({ status }) => status)).toEqual(['confirmed', 'observation']);
    expect(answer.verdicts?.[0].text).toMatch(/контрольном запросе/i);
    expect(answer.verdicts?.[1].text).toMatch(/без фильтра.*самара присутствует/i);
  });
  const price = [
    [true, 'Карточка без цены последняя', ['null-last'], ['confirmed']],
    [true, 'Карточка без цены пропала', ['null-missing'], ['refuted']],
    [false, 'Карточка без цены первая', ['null-first'], ['confirmed']],
    [false, 'Сортировка правильная', ['sort-correct'], ['refuted']],
    [false, '500 и 900 идут по возрастанию, поэтому сортировка правильная', ['numeric-ascending', 'sort-correct'], ['confirmed', 'refuted']],
  ] as const;
  it.each(price)('sort — fixed=%s, %s', (fixed, question, claims, expected) => {
    const answer = guideFeedback(fixed ? sortFixed : sortBroken, question.toLowerCase(), [...claims]);
    expect(answer.verdicts?.map(({ status }) => status)).toEqual(expected);
    if (question.includes('пропала')) expect(answer.text).toMatch(/присутствует.*3/i);
  });
  const city = [
    [true, 'Выдача без фильтра правильная', ['main-correct'], 'confirmed'],
    [true, 'Самара отсутствует', ['main-missing-samara'], 'refuted'],
    [false, 'Без фильтра отсутствует Самара', ['main-missing-samara'], 'confirmed'],
    [false, 'Выдача без фильтра правильная', ['main-correct'], 'refuted'],
    [false, 'В контроле нет Самары, это дефект', ['control-missing-samara-is-defect'], 'refuted'],
    [false, 'В контроле только Казань', ['control-correct'], 'confirmed'],
  ] as const;
  it.each(city)('search — fixed=%s, %s', (fixed, question, claims, expected) => {
    const answer = guideFeedback(fixed ? searchFixed : searchBroken, question.toLowerCase(), [...claims]);
    expect(answer.verdicts?.map(({ status }) => status)).toEqual([expected]);
    if (question.includes('контроле')) expect(answer.sources.filter((source) => 'checkId' in source).map((source) => source.checkId)).toEqual(['kazan']);
  });
  it('separates guesses about causes from facts and asks what to check', () => {
    const answer = guideFeedback(searchBroken, 'может это кэш или пагинация?', []);
    expect(answer.text).toMatch(/гипотез/i);
    expect(answer.verdicts).toEqual([{ status: 'observation', text: expect.stringMatching(/стенд вернул/i) }]);
  });
  it('keeps explicit polarity if the model reverses it or adds a fabricated claim', () => {
    const price = guideFeedback(sortFixed, 'карточка без цены пропала', ['not-null-missing', 'sort-correct']);
    expect(price.verdicts?.map(({ status }) => status)).toEqual(['refuted']);
    const city = guideFeedback(searchFixed, 'в основном запросе самара не пропала', ['main-missing-samara']);
    expect(city.verdicts?.map(({ status }) => status)).toEqual(['confirmed']);
  });
  it('distinguishes an explicitly correct plan from omitting the unpriced item', () => {
    expect(guidePlan(sortTask, 'оставлю карточку без цены в конце')?.text).toMatch(/верно/i);
    expect(guidePlan(sortTask, 'карточку без цены исключу')?.text).toMatch(/исключение противоречит/i);
    expect(guidePlan(sortTask, 'проверю только две числовые цены')?.text).toMatch(/пропустит/i);
  });
});
