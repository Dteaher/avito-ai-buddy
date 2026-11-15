import { randomUUID } from 'node:crypto';
import { repeatedIds } from '../shared/run-summary.ts';
import { cities, type CatalogCheck, type Check, type CheckInput, type CheckResult, type City, type CityRun, type Listing, type Task } from '../shared/contracts.ts';

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

export function setPlan(current: Task = task): { field: 'city' | 'status'; values: City[]; checks: CatalogCheck[] } {
  return current.comparison ?? {
    field: 'city' as const, values: Object.keys(cities) as City[],
    checks: checks.map((check) => ({ ...check, required: ruleCities[check.id] })),
  };
}

export function parseChecks(body: unknown, current: Task = task): CheckInput[] | undefined {
  const { checks, values } = setPlan(current);
  if (!isObject(body) || Object.keys(body).length !== 1 || !Array.isArray(body.checks) || body.checks.length !== checks.length) return;
  const selections: CheckInput[] = [];

  for (const check of checks) {
    const input = body.checks.find((candidate: unknown) => isObject(candidate) && candidate.id === check.id);
    if (!isObject(input) || Object.keys(input).length !== (check.uniqueIds ? 3 : 2)) return;
    if (check.uniqueIds && typeof input.expectedUniqueIds !== 'boolean') return;
    const selected: unknown = input.expectedCities;
    if (!Array.isArray(selected) || selected.some((value) => !values.includes(value)) || new Set(selected).size !== selected.length) return;
    const expectedCities = values.filter((value) => selected.includes(value));
    selections.push(check.uniqueIds ? { id: check.id, expectedCities, expectedUniqueIds: input.expectedUniqueIds as boolean }
      : { id: check.id, expectedCities });
  }

  return selections;
}

export const ruleCities = {
  'without-city': [...new Set(listings.map(({ city }) => city))],
  kazan: ['kazan'],
} satisfies Record<(typeof checks)[number]['id'], City[]>;

export async function fetchStand(origin: string, path: string, signal: AbortSignal, headers?: HeadersInit) {
  const response = await fetch(new URL(path, origin), { signal, headers, redirect: 'error' });
  const rawBody = await response.text();
  if (!response.ok) throw new Error(`Stand returned ${response.status}`);
  const data: unknown = JSON.parse(rawBody);
  if (!isObject(data) || !Array.isArray(data.items)) {
    throw new Error('Invalid stand response');
  }
  const items: unknown[] = data.items;
  const mode = response.headers.get('x-avito-demo-stand');
  const standMode: 'defect' | 'fixed' | undefined = mode === 'defect' || mode === 'fixed' ? mode : undefined;
  return { items, rawBody, status: response.status, standMode };
}

async function checkResponse(origin: string, input: CheckInput, signal: AbortSignal, current: Task, headers?: HeadersInit): Promise<CheckResult> {
  const plan = setPlan(current);
  const { required, ...check } = plan.checks.find(({ id }) => id === input.id)!;
  const { items: rawItems, rawBody, status, standMode } = await fetchStand(origin, check.path, signal, headers);
  const items: Listing[] = rawItems.map((item) => {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.title !== 'string'
      || !plan.values.includes(item[plan.field] as City)) throw new Error('Invalid listing group');
    return { id: item.id, title: item.title, city: item[plan.field] as City };
  });
  const actualCities = [...new Set(items.map(({ city }) => city))];
  const expectedCities = [...input.expectedCities];
  const missing = expectedCities.filter((city) => !actualCities.includes(city));
  const extra = actualCities.filter((city) => !expectedCities.includes(city));
  const duplicateIds = check.uniqueIds ? repeatedIds(items) : undefined;
  const unique = !duplicateIds?.length;
  return {
    ...check, ...input, duplicateIds, status, standMode, items, rawBody, actualCities,
    ruleCities: required, missing, extra, matches: missing.length + extra.length === 0 && (!check.uniqueIds || input.expectedUniqueIds === unique),
    followsRule: expectedCities.length === required.length && required.every((city) => expectedCities.includes(city)) && (!check.uniqueIds || input.expectedUniqueIds === true),
  };
}

export async function executeRun(origin: string, inputs: CheckInput[], current = task, headers?: HeadersInit): Promise<CityRun> {
  const signal = AbortSignal.timeout(5000);
  const results = await Promise.all(inputs.map((input) => checkResponse(origin, input, signal, current, headers)));
  return { id: randomUUID(), task: current, checks: results, checkedAt: new Date().toISOString() };
}
