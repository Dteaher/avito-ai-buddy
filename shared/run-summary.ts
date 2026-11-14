import { cities, type Run } from './contracts.ts';

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
    const noPrice = check.fixtures.find(({ price }) => price === null);
    const expectedPosition = noPrice ? check.ruleOrder.indexOf(noPrice.id) + 1 : 0;
    const actualPosition = noPrice ? check.actualOrder.indexOf(noPrice.id) + 1 : 0;
    const order = check.ruleOrder.length === check.actualOrder.length
      && check.ruleOrder.every((id, index) => id === check.actualOrder[index]);
    const position = expectedPosition && actualPosition && expectedPosition !== actualPosition
      ? ` Объявление без цены на ${actualPosition}-м месте вместо ${expectedPosition}-го.` : '';
    return `${request} По правилу: ${labels(check.ruleOrder, check.fixtures)}. Стенд вернул: ${labels(check.actualOrder, check.items)}. ${order ? 'Порядок соответствует правилу.' : 'Порядок расходится с правилом.'}${position}`;
  });
}
