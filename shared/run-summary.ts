import { cities, type PriceResult, type Run } from './contracts.ts';

export function priceObservations(check: PriceResult) {
  const prices = check.items.flatMap(({ price }) => price === null ? [] : [price]);
  const ascending = prices.length >= 2 ? prices.every((price, index) => index === 0 || prices[index - 1] <= price) : undefined;
  const expectedId = check.fixtures.find(({ price }) => price === null)?.id;
  const position = check.items.findIndex(({ id, price }) => id === expectedId && price === null) + 1;
  const required = check.ruleOrder.indexOf(expectedId ?? '') + 1;
  const followsRule = check.ruleOrder.length === check.actualOrder.length && position === required && ascending === true
    && check.ruleOrder.every((id, index) => id === check.actualOrder[index]);
  return { ascending, position, required, followsRule };
}

export function sameObservedResult(first: Run, second: Run) {
  const observed = (run: Run) => run.checks.map((check) => 'actualOrder' in check
    ? [check.id, check.status, check.items.map(({ id, price }) => [id, price])]
    : [check.id, check.status, [...check.actualCities].sort()]);
  return JSON.stringify(observed(first)) === JSON.stringify(observed(second));
}

export function standLabel(run: Run) {
  const modes = new Set(run.checks.map(({ standMode }) => standMode));
  if (modes.size > 1) return 'Состояние различалось между запросами';
  if (modes.has('fixed')) return 'Демо-стенд исправлен';
  if (modes.has('defect')) return 'Демо-стенд с дефектом';
  return 'Состояние стенда не записано';
}

export function responseFollowsRule(check: Run['checks'][number]) {
  return 'ruleCities' in check
    ? check.actualCities.length === check.ruleCities.length && check.ruleCities.every((city) => check.actualCities.includes(city))
    : priceObservations(check).followsRule;
}

export function summarizeRun(run: Run) {
  return run.checks.map((check) => {
    const request = `GET ${check.path} · HTTP ${check.status}.`;
    if ('ruleCities' in check) {
      const missing = check.ruleCities.filter((city) => !check.actualCities.includes(city));
      const extra = check.actualCities.filter((city) => !check.ruleCities.includes(city));
      const list = (values: typeof check.ruleCities) => values.map((city) => cities[city]).join(', ') || 'пусто';
      const differences = [
        missing.length && `Отсутствуют города: ${list(missing)}.`,
        extra.length && `Лишние города: ${list(extra)}.`,
      ].filter(Boolean).join(' ');
      return `${request} По правилу: ${list(check.ruleCities)}. Стенд вернул: ${list(check.actualCities)}. ${differences || 'Города соответствуют правилу.'}`;
    }
    const labels = (ids: string[], items: typeof check.fixtures) => ids.slice(0, 12).map((id) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return 'другое объявление';
      return item.price === null ? 'без цены' : `${item.price} ₽`;
    }).join(' → ') || 'пусто';
    const { position: actualPosition, required: expectedPosition, followsRule: order } = priceObservations(check);
    const position = expectedPosition && actualPosition && expectedPosition !== actualPosition
      ? ` Объявление без цены на ${actualPosition}-м месте вместо ${expectedPosition}-го.` : '';
    return `${request} По правилу: ${labels(check.ruleOrder, check.fixtures)}. Стенд вернул: ${labels(check.actualOrder, check.items)}. ${order ? 'Порядок соответствует правилу.' : 'Порядок расходится с правилом.'}${position}`;
  });
}
