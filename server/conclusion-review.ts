import { cities, type CheckResult, type ClaimVerdict, type PriceResult, type Run } from '../shared/contracts.ts';
import { explainPriceRule, priceObservations } from '../shared/run-summary.ts';

export const priceClaims = {
  'numeric-ascending': 'числовые цены возрастают',
  'sort-correct': 'весь порядок соответствует инструкции',
  'null-first': 'карточка без цены первая',
  'null-last': 'карточка без цены последняя',
  'null-missing': 'карточка без цены отсутствует',
};
export const cityClaims = {
  'main-correct': 'состав без фильтра правильный',
  'control-correct': 'состав с фильтром Казань правильный',
  'main-missing-samara': 'Самара отсутствует без фильтра',
  'control-missing-samara': 'Самара отсутствует в контрольном запросе',
  'control-missing-samara-is-defect': 'отсутствие Самары в фильтре Казань является дефектом',
};

function containsSame<T>(actual: T[], expected: T[]) {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function priceFacts(check: PriceResult) {
  const facts = priceObservations(check);
  const { ascending, position, followsRule: order } = facts;
  const unpricedFact = position
    ? `Карточка без цены присутствует на ${position}-м месте. Пункт 2 требует ставить такие карточки после карточек с ценой.`
    : 'В ответе отсутствует исходная карточка без цены либо у неё появилась цена. Изменение состава и цен показано отдельно.';
  const numberFact = ascending === undefined ? 'В ответе меньше двух числовых цен.'
    : ascending ? 'Числовые цены действительно возрастают.' : 'Числовые цены идут с нарушением возрастания.';
  return {
    'numeric-ascending': [ascending, numberFact],
    'sort-correct': [order, `${explainPriceRule(facts)} ${unpricedFact}`],
    'null-first': [position === 1, unpricedFact],
    'null-last': [position !== 0 && check.items.slice(position).every(({ price }) => price === null), unpricedFact],
    'null-missing': [position === 0, unpricedFact],
  } satisfies Record<keyof typeof priceClaims, [boolean | undefined, string]>;
}

function cityFacts(check: CheckResult): Record<string, readonly [boolean, string]> {
  const main = check.id === 'without-city';
  const samara = check.actualCities.includes('samara');
  const required = check.ruleCities.includes('samara');
  const same = containsSame(check.actualCities, check.ruleCities);
  const prefix = main ? 'Без фильтра' : 'В контрольном запросе';
  const cityList = check.actualCities.map((city) => cities[city]).join(', ') || 'пусто';
  const fact = `${prefix} стенд вернул: ${cityList}. ${samara ? 'Самара присутствует.' : 'Самара отсутствует.'} ${main ? 'По пункту 1 нужны Казань и Самара.' : 'По пункту 2 нужна только Казань.'}`;
  return main
    ? { 'main-correct': [same, fact], 'main-missing-samara': [!samara, fact] } as const
    : { 'control-correct': [same, fact], 'control-missing-samara': [!samara, fact], 'control-missing-samara-is-defect': [required && !samara, fact] } as const;
}

function inferPrice(query: string) {
  const claims: string[] = [];
  const location = /без цены|без ценника|цен[ауы] (?:нет|отсутствует)|без стоимост|null/.test(query);
  if (location) {
    const missing = query.match(/(не\s+)?(?:пропал|потерял|исчез|отсутств|выпал|выбросил|не приш|не вернул)/);
    if (missing && !/цен[ауы] отсутствует/.test(query)) claims.push(missing[1] ? 'not-null-missing' : 'null-missing');
    else if (/перв|начал/.test(query)) claims.push(/не\s+(?:перв|в начал)/.test(query) ? 'not-null-first' : 'null-first');
    else if (/последн|в конце|хвост|треть/.test(query)) claims.push(/не\s+(?:последн|в конце)/.test(query) ? 'not-null-last' : 'null-last');
  }
  if (/(?:числов|500.{0,30}900|цен[ыу]).{0,35}(?:возраста|растут|по порядку|идут правильно)/.test(query)) {
    claims.push(/не\s+(?:возраста|растут|идут правильно)/.test(query) ? 'not-numeric-ascending' : 'numeric-ascending');
  }
  if (/(?:сортиров|порядок).{0,30}(?:работает|правильн|верн|корректн|соответству|отвечает|сломан|ошиб)|дефект.{0,30}сортиров.{0,30}нет/.test(query)) {
    claims.push(/(?:сортиров|порядок).{0,25}(?:не (?:работает|соответству|отвечает)|не\s*(?:правильн|верн|корректн)|сломан|ошиб)/.test(query)
      ? 'not-sort-correct' : 'sort-correct');
  }
  return claims;
}

function searchScope(query: string) {
  const main = /без (?:фильтр|город|параметр)|нефильтрован|основн|общ(?:ем|ий) запрос/.test(query);
  const control = /контрол|фильтр (?:по казан|казан)|city\s*=\s*kazan/.test(query);
  if ((main && control) || /(?:оба|обоих)\s+(?:запрос|ответ)/.test(query)) return 'both';
  if (control) return 'control';
  if (main) return 'main';
}

function inferCities(query: string, scope: ReturnType<typeof searchScope>) {
  const claims: string[] = [];
  const missing = /(?:нет|отсутств|не приш|не хватает|пропал).{0,30}самар|самар.{0,30}(?:нет|отсутств|не приш|пропал)/.test(query);
  if (missing && scope !== 'control') claims.push(/не (?:отсутствует|пропала)/.test(query) ? 'not-main-missing-samara' : 'main-missing-samara');
  if (missing && scope === 'control') {
    if (/дефект|ошиб/.test(query) && !/не (?:дефект|ошиб)/.test(query)) claims.push('control-missing-samara-is-defect');
    else if (/(?:контрол|результат|состав).{0,35}(?:коррект|верн|правиль)|только казан/.test(query)) claims.push('control-correct');
    else claims.push(/не (?:отсутствует|пропала)/.test(query) ? 'not-control-missing-samara' : 'control-missing-samara');
  }
  const success = /правильн|корректн|работа[ею]т|штатн|соответству|верн|нормальн|только казан|казан.{0,15}и самар/.test(query);
  if (missing && scope !== 'control' && /(?:состав|выдач).{0,25}не\s*(?:правильн|верн|корректн)/.test(query)) {
    claims.push('not-main-correct');
  }
  if (success && !missing) {
    const negative = /не (?:правильн|корректн|работа)|некорректн|неправильн/.test(query) ? 'not-' : '';
    if (scope !== 'control') claims.push(`${negative}main-correct`);
    if (scope === 'control' || scope === 'both') claims.push(`${negative}control-correct`);
  }
  if (missing && scope === 'both' && /только казан/.test(query)) claims.push('control-correct');
  return claims;
}

const unclear = 'Уточни, что именно утверждаешь об ответе стенда: состав выдачи или порядок элементов.';

function reviewClauses(query: string) {
  // Quoted punctuation cannot terminate the surrounding reported statement.
  const quoted = query.replace(/«[^»]+»|“[^”]+”|"[^"]+"/g, (text, offset: number) => {
    const before = query.slice(0, offset).trimEnd();
    const standalone = !before || /[.!?;:]$/.test(before);
    return `${standalone ? 'цитата ' : ''}${text.slice(1, -1).replace(/[.!?;,:]/g, ' ')}`;
  });
  return quoted.split(/(?<=[.!?;])\s+|\n+/).flatMap((sentence) => {
    const question = /\?[.!?]*$/.test(sentence.trimEnd());
    const parts = /^\s*если\s/.test(sentence) ? [sentence] : sentence.split(/,\s*(?:но|а|зато|однако)\s+/);
    return parts.map((text) => {
      const clause = text.trim();
      const qualified = question
        || /(?:^|[^\p{L}])(?:цитата|если|возможно|наверное|похоже|может\s+быть|вряд\s+ли|кажется|предполагаю|сомневаюсь|есть\s+ли)(?=$|[^\p{L}])/u.test(clause)
        || /не\s+(?:\S+\s+){0,2}(?:уверен|знаю|думаю|считаю|утверждаю|говорю|скажу|сказать|утверждать|подтверд|доказано)/.test(clause)
        || /(?:коллег|наставник|автор|в тикете|в отчете).{0,45}(?:написал|пишет|сказал|считает|утвержда|указал|говорит)|(?:написал|сказал|утвержда).{0,25}(?:коллег|наставник|автор)/.test(clause)
        || /(?:сказали|написали|сообщили),?\s+что|(?:^|\s)по словам\s/.test(clause);
      return { clause, qualified };
    }).filter(({ clause }) => clause.length > 0);
  });
}

export function reviewClaims(run: Run, query: string, extracted?: string[]) {
  const scope = searchScope(query);
  const price = run.kind === 'price-order';
  const checks = price ? run.checks : run.checks.filter(({ id }) => scope === 'control' ? id === 'kazan'
    : scope === 'main' ? id === 'without-city' : true);
  const clauses = reviewClauses(query);
  const scoped = clauses.map(({ clause, qualified }) => ({
    qualified, scope: searchScope(clause),
    claims: price ? inferPrice(clause) : inferCities(clause, searchScope(clause) ?? scope),
  }));
  const claims = new Set(scoped.filter(({ qualified }) => !qualified).flatMap(({ claims }) => claims));
  const verdicts: ClaimVerdict[] = [];
  const sources = new Set<Run['checks'][number]['id']>();
  const observations = new Set<string>();
  for (const check of checks) {
    const tests: Record<string, readonly [boolean | undefined, string]> = 'ruleOrder' in check ? priceFacts(check) : cityFacts(check);
    for (const claim of claims) {
      const negative = claim.startsWith('not-');
      const key = negative ? claim.slice(4) : claim;
      if (!Object.hasOwn(tests, key)) continue;
      const [confirmed, fact] = tests[key];
      const labels: Record<string, string> = price ? priceClaims : cityClaims;
      const status = confirmed === undefined ? 'unclear' : confirmed !== negative ? 'confirmed' : 'refuted';
      const label = negative ? `неверно, что ${labels[key]}` : labels[key];
      verdicts.push({ status, text: `«${label}». ${fact}` });
      sources.add(check.id);
    }
    const neutral = scoped.filter(({ qualified, scope }) => qualified && (scope !== 'main' || check.id === 'without-city')
      && (scope !== 'control' || check.id === 'kazan'));
    const keys = neutral.flatMap(({ claims }) => claims);
    // A model-only interpretation may point to evidence. It cannot attribute a claim to the trainee.
    if (!claims.size && !neutral.length) keys.push(...(extracted ?? []));
    const fallbackKey = price ? 'null-missing' : check.id === 'kazan' ? 'control-missing-samara' : 'main-missing-samara';
    if (!keys.length && neutral.length) keys.push(fallbackKey);
    for (const claim of keys) {
      const key = claim.replace(/^not-/, '');
      if (!Object.hasOwn(tests, key)) continue;
      observations.add(tests[key][1]);
      sources.add(check.id);
    }
  }
  if (observations.size) verdicts.push({ status: 'observation', text: [...observations].join(' ') });
  if (!verdicts.length) verdicts.push({ status: 'unclear', text: unclear });
  const hypothesis = /(?:к[еэ]ш|пагинац|гипотез|причин|отсе[яи]|из-за|наверно.*база)/.test(query)
    ? 'Причина остаётся гипотезой. Этот прогон устанавливает содержимое ответа.' : '';
  return { verdicts, ids: sources.size ? sources : new Set(checks.map(({ id }) => id)), hypothesis };
}
