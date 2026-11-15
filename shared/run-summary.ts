import { groupLabels, type PriceResult, type Run } from './contracts.ts';

type PriceEvidence = Pick<PriceResult, 'items' | 'fixtures' | 'expectedOrder' | 'actualOrder' | 'ruleOrder'>;

export function priceObservations(check: PriceEvidence) {
  const prices = check.items.flatMap(({ price }) => price === null ? [] : [price]);
  const inverted = prices.findIndex((price, index) => index > 0 && prices[index - 1] > price);
  const ascending = prices.length >= 2 ? inverted === -1 : undefined;
  const firstUnpriced = check.items.findIndex(({ price }) => price === null);
  const unpricedInMiddle = firstUnpriced >= 0 && check.items.slice(firstUnpriced + 1).some(({ price }) => price !== null);
  const expectedId = check.fixtures.find(({ price }) => price === null)?.id;
  const position = check.items.findIndex(({ id, price }) => id === expectedId && price === null) + 1;
  const required = check.ruleOrder.indexOf(expectedId ?? '') + 1;
  const sameItems = check.items.length === check.fixtures.length
    && check.fixtures.every(({ id }) => check.actualOrder.includes(id));
  const positionsMatch = sameItems && check.expectedOrder.every((id, index) => check.actualOrder[index] === id);
  const changes = check.fixtures.flatMap(({ id, title, price }) => {
    const actual = check.items.find((item) => item.id === id);
    return actual && actual.price !== price ? [{ id, title, before: price, after: actual.price }] : [];
  });
  const followsRule = inverted === -1 && !unpricedInMiddle;
  const inversion = inverted < 0 ? undefined : [prices[inverted - 1], prices[inverted]];
  return { ascending, position, required, followsRule, sameItems, positionsMatch, changes, inversion, unpricedInMiddle,
    matches: positionsMatch && changes.length === 0 };
}

export function formatPrice(price: number | null) {
  return price === null ? 'без цены' : `${new Intl.NumberFormat('ru-RU').format(price)} ₽`;
}

export function explainPriceRule(facts: ReturnType<typeof priceObservations>) {
  return facts.followsRule ? 'Порядок соответствует правилу.'
    : `Порядок расходится с правилом. ${[
      facts.inversion && `${formatPrice(facts.inversion[0])} перед ${formatPrice(facts.inversion[1])}.`,
      facts.unpricedInMiddle && 'Карточка без цены стоит перед карточкой с ценой.',
    ].filter(Boolean).join(' ')}`;
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
      const list = (values: typeof check.ruleCities) => values.map((city) => groupLabels[city]).join(', ') || 'пусто';
      const groups = run.task.comparison ? 'группы' : 'города';
      const differences = [
        missing.length && `Отсутствуют ${groups}: ${list(missing)}.`,
        extra.length && `Лишние ${groups}: ${list(extra)}.`,
      ].filter(Boolean).join(' ');
      return `${request} По правилу: ${list(check.ruleCities)}. Стенд вернул: ${list(check.actualCities)}. ${differences || 'Состав соответствует правилу.'}`;
    }
    const labels = (ids: string[], items: typeof check.fixtures) => ids.slice(0, 12).map((id) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return 'другое объявление';
      return item.price === null ? 'без цены' : `${item.price} ₽`;
    }).join(' → ') || 'пусто';
    const facts = priceObservations(check);
    const { position: actualPosition, required: expectedPosition } = facts;
    const position = expectedPosition && actualPosition && expectedPosition !== actualPosition
      ? ` Объявление без цены на ${actualPosition}-м месте вместо ${expectedPosition}-го.` : '';
    const changes = facts.changes.map(({ title, before, after }) => `${title}: ${formatPrice(before)} → ${formatPrice(after)}.`).join(' ');
    const data = [changes && `Цены изменились. ${changes}`, !facts.sameItems && 'Состав отличается от исходного набора.'].filter(Boolean).join(' ');
    return `${request} Ожидали: ${labels(check.expectedOrder, check.fixtures)}. Стенд вернул: ${labels(check.actualOrder, check.items)}. ${facts.matches ? 'Ожидание совпало.' : 'Ожидание отличается.'} ${data ? `${data} ` : ''}${explainPriceRule(facts)}${position}`;
  });
}

export function responseMatchesExpectation(check: Run['checks'][number]) {
  return 'ruleOrder' in check ? priceObservations(check).matches : check.matches;
}
