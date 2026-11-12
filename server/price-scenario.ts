import { randomUUID } from 'node:crypto';
import type { PriceCheck, PriceListing, PriceRun, Task } from '../shared/contracts.ts';
import { fetchStand, isObject } from './scenario.ts';

export const sortTask: Task = {
  id: 'SORT-01',
  title: 'Проверь сортировку объявлений от дешёвых к дорогим',
  description: 'Составь ожидаемый порядок трёх объявлений по инструкции команды. Если возникнет вопрос, спроси Buddy.',
  criterion: 'Цены идут по возрастанию. Объявление без цены остаётся в выдаче и стоит в конце.',
  instruction: {
    id: 'sort-guide-v1', title: 'Правила сортировки по цене', team: 'Команда поиска', version: '1.0',
    rules: [
      'При sort=price_asc объявления с числовой ценой идут от дешёвых к дорогим.',
      'Объявления без цены остаются в выдаче и располагаются после всех объявлений с ценой.',
      'HTTP 200 означает, что запрос обработан. При проверке сортировки сравнивай последовательность всех объявлений.',
    ],
  },
};

export const priceItems: PriceListing[] = [
  { id: 'ad-202', title: 'Книжная полка', price: 900 },
  { id: 'ad-203', title: 'Подставка', price: null },
  { id: 'ad-201', title: 'Настольная лампа', price: 500 },
];

export const priceCheck: PriceCheck = {
  id: 'price-asc', label: 'По возрастанию цены', path: '/demo/search?sort=price_asc', parameter: 'sort=price_asc',
};

export function parsePriceCheck(body: unknown): string[] | undefined {
  if (!isObject(body) || Object.keys(body).length !== 1 || !Array.isArray(body.checks) || body.checks.length !== 1) return;
  const input: unknown = body.checks[0];
  if (!isObject(input) || Object.keys(input).length !== 2 || input.id !== priceCheck.id) return;
  const { expectedOrder } = input;
  if (!Array.isArray(expectedOrder) || expectedOrder.length !== priceItems.length
    || !priceItems.every(({ id }) => expectedOrder.includes(id))) return;
  return expectedOrder;
}

function isPriceListing(item: unknown): item is PriceListing {
  return isObject(item) && typeof item.id === 'string' && typeof item.title === 'string'
    && (item.price === null || (typeof item.price === 'number' && Number.isFinite(item.price)));
}

function sameOrder(first: string[], second: string[]) {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}

export async function executePriceRun(origin: string, expectedOrder: string[]): Promise<PriceRun> {
  const { items, rawBody, status } = await fetchStand(origin, priceCheck.path, AbortSignal.timeout(5000));
  if (!items.every(isPriceListing)) throw new Error('Invalid price listings');
  const actualOrder = items.map(({ id }) => id);
  const ruleOrder = priceItems.toSorted((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)).map(({ id }) => id);
  const sameItems = actualOrder.length === expectedOrder.length && expectedOrder.every((id) => actualOrder.includes(id));
  return {
    kind: 'price-order', id: randomUUID(), task: sortTask, checkedAt: new Date().toISOString(),
    checks: [{
      ...priceCheck, status, rawBody, items, fixtures: priceItems, expectedOrder, actualOrder, ruleOrder, sameItems,
      matches: sameOrder(expectedOrder, actualOrder), followsRule: sameOrder(expectedOrder, ruleOrder),
    }],
  };
}
