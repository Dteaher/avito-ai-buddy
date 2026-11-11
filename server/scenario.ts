import { randomUUID } from 'node:crypto';
import { cities, type Check, type CheckInput, type CheckResult, type City, type Listing, type Run, type Task } from '../shared/contracts.ts';

export const trainee = 'demo-trainee';

export const task: Task = {
  id: 'SEARCH-01',
  title: 'Проверь выдачу, когда пользователь не выбрал город',
  description: 'На тестовом стенде есть по одному объявлению из Казани и Самары. Проверь, как параметр города влияет на выдачу.',
  criterion: 'Без города в выдаче есть объявления из Казани и Самары. С фильтром по Казани — только из Казани.',
  instruction: {
    id: 'search-guide-v1',
    title: 'Правила поиска по городу',
    team: 'Команда поиска',
    version: '1.0',
    rules: [
      'Если город не указан, фильтрация по городу не применяется. В тестовой выдаче должны быть Казань и Самара.',
      'Если город указан, выдача содержит только объявления из этого города. Для city=kazan ожидаем Казань.',
      'HTTP 200 означает, что запрос обработан. Содержимое ответа нужно сверить с ожидаемым поведением задачи.',
    ],
  },
};

export const listings: Listing[] = [
  { id: 'ad-101', title: 'Настольная лампа', city: 'kazan' },
  { id: 'ad-102', title: 'Книжная полка', city: 'samara' },
];

export const checks = [
  { id: 'without-city', label: 'Без города', path: '/demo/search', parameter: 'Город не задан' },
  { id: 'kazan', label: 'Фильтр по Казани', path: '/demo/search?city=kazan', parameter: 'city=kazan' },
] as const satisfies readonly Check[];

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCity(value: unknown): value is City {
  return typeof value === 'string' && Object.hasOwn(cities, value);
}

export function parseChecks(body: unknown): CheckInput[] | undefined {
  if (!isObject(body) || Object.keys(body).length !== 1 || !Array.isArray(body.checks) || body.checks.length !== checks.length) return;
  const selections: CheckInput[] = [];

  for (const check of checks) {
    const input = body.checks.find((candidate: unknown) => isObject(candidate) && candidate.id === check.id);
    if (!isObject(input) || Object.keys(input).length !== 2) return;
    const selected: unknown = input.expectedCities;
    if (!Array.isArray(selected) || !selected.every(isCity) || new Set(selected).size !== selected.length) return;
    selections.push({ id: check.id, expectedCities: (Object.keys(cities) as City[]).filter((city) => selected.includes(city)) });
  }

  return selections;
}

function isListing(value: unknown): value is Listing {
  return isObject(value) && typeof value.id === 'string' && typeof value.title === 'string' && isCity(value.city);
}

const ruleCities = {
  'without-city': [...new Set(listings.map(({ city }) => city))],
  kazan: ['kazan'],
} satisfies Record<CheckInput['id'], City[]>;

async function checkResponse(origin: string, input: CheckInput, signal: AbortSignal): Promise<CheckResult> {
  const check = checks.find(({ id }) => id === input.id)!;
  const response = await fetch(new URL(check.path, origin), { signal, redirect: 'error' });
  const rawBody = await response.text();
  if (!response.ok) throw new Error(`Stand returned ${response.status}`);
  const data: unknown = JSON.parse(rawBody);
  if (!isObject(data) || !Array.isArray(data.items) || !data.items.every(isListing)) {
    throw new Error('Invalid stand response');
  }

  const { items } = data;
  const actualCities = [...new Set(items.map(({ city }) => city))];
  const expectedCities = [...input.expectedCities];
  const required: City[] = ruleCities[input.id];
  const missing = expectedCities.filter((city) => !actualCities.includes(city));
  const extra = actualCities.filter((city) => !expectedCities.includes(city));
  return {
    ...check, expectedCities, status: response.status, items, rawBody, actualCities,
    ruleCities: required, missing, extra, matches: missing.length + extra.length === 0,
    followsRule: expectedCities.length === required.length && required.every((city) => expectedCities.includes(city)),
  };
}

export async function executeRun(origin: string, inputs: CheckInput[]): Promise<Run> {
  const signal = AbortSignal.timeout(5000);
  const results = await Promise.all(inputs.map((input) => checkResponse(origin, input, signal)));
  return { id: randomUUID(), task, checks: results, checkedAt: new Date().toISOString() };
}
