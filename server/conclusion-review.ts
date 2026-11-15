import { groupLabels, type CheckResult, type ClaimVerdict, type PriceResult, type Run } from '../shared/contracts.ts';
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
export const archiveClaims = {
  'main-correct': 'состав выдачи без фильтра соответствует правилу',
  'control-correct': 'контроль по активным товарам соответствует правилу',
  'main-missing-archive': 'без фильтра исчезли архивные товары',
  'control-proves-main': 'успешный фильтр доказывает корректность общей выдачи',
  'filtered-has-archive': 'архивные товары попали в ответ с status=active',
  'unfiltered-proves-filter': 'общая выдача доказывает корректность фильтра',
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
  const cityList = check.actualCities.map((city) => groupLabels[city]).join(', ') || 'пусто';
  const fact = `${prefix} стенд вернул: ${cityList}. ${samara ? 'Самара присутствует.' : 'Самара отсутствует.'} ${main ? 'По пункту 1 нужны Казань и Самара.' : 'По пункту 2 нужна только Казань.'}`;
  return main
    ? { 'main-correct': [same, fact], 'main-missing-samara': [!samara, fact] } as const
    : { 'control-correct': [same, fact], 'control-missing-samara': [!samara, fact], 'control-missing-samara-is-defect': [required && !samara, fact] } as const;
}

function archiveFacts(check: CheckResult): Record<string, readonly [boolean, string]> {
  const main = check.id === 'all-statuses';
  const same = containsSame(check.actualCities, check.ruleCities);
  const actual = check.actualCities.map((group) => groupLabels[group]).join(', ') || 'пусто';
  const expected = check.ruleCities.map((group) => groupLabels[group]).join(', ');
  const fact = `${check.label}: стенд вернул ${actual}. По правилу ожидаются ${expected}.`;
  return main ? { 'main-correct': [same, fact], 'main-missing-archive': [!check.actualCities.includes('archived'), fact],
    'unfiltered-proves-filter': [false, `${fact} Работу фильтра показывает отдельный запрос с status=active.`] }
    : { 'control-correct': [same, fact], 'filtered-has-archive': [check.actualCities.includes('archived'), fact],
      'control-proves-main': [false, `${fact} Чтобы проверить архивные товары, открой ответ запроса без фильтра.`] };
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

function searchScope(query: string, filteredPrimary = false) {
  const main = /без (?:фильтр|город|параметр)|нефильтрован|общ(?:ем|ий) запрос|общ.{0,8}выдач/.test(query)
    || (filteredPrimary ? /контрол/.test(query) : /основн/.test(query));
  const control = /фильтр (?:по казан|казан|по активн)|city\s*=\s*kazan|status\s*=\s*active/.test(query)
    || (filteredPrimary ? /основн/.test(query) : /контрол/.test(query));
  if ((main && control) || /(?:оба|обоих)\s+(?:запрос|ответ)/.test(query)) return 'both';
  if (control) return 'control';
  if (main) return 'main';
}

function inferArchive(query: string, scope: ReturnType<typeof searchScope>, filteredPrimary: boolean) {
  const claims: string[] = [];
  const missing = /архив.{0,35}(?:нет|отсутств|пропа|не приш)|(?:нет|отсутств|пропа|не приш).{0,35}архив/.test(query);
  if (missing && scope !== 'control' && (!filteredPrimary || scope === 'main' || scope === 'both')) {
    claims.push(/не (?:пропал|отсутств)/.test(query) ? 'not-main-missing-archive' : 'main-missing-archive');
  }
  const filteredClaim = scope === 'control' || (filteredPrimary && !scope);
  if (filteredClaim && /архив/.test(query)) {
    if (/нет|отсутств|не (?:попал|вернул|остал|приш)|исключ/.test(query)) claims.push('not-filtered-has-archive');
    else if (/попал|вернул|остал|приш|есть|в списке/.test(query)) claims.push('filtered-has-archive');
  }
  const matches = /соответству|правильн|корректн|прош[её]л|работает|только активн/.test(query);
  if (matches && !claims.length) {
    const prefix = /не\s*(?:соответству|правильн|корректн|прош[её]л|работает)/.test(query) ? 'not-' : '';
    if (scope === 'control' || scope === 'both' || (filteredPrimary && !scope)) claims.push(prefix + 'control-correct');
    if (scope === 'main' || scope === 'both' || (!filteredPrimary && !scope)) claims.push(prefix + 'main-correct');
  }
  if (/контрол.{0,55}(?:доказыва|достаточ|значит).{0,45}(?:фильтр|выдач|архив|все)/.test(query)) {
    claims.push(filteredPrimary ? 'unfiltered-proves-filter' : 'control-proves-main');
  }
  return claims;
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
        || /(?:коллег|наставник|автор|в тикете|в отчете|в обращении).{0,45}(?:написа[лн]|пишет|сказал|считает|утвержда|указа[лн]|говорит)|(?:написал|сказал|утвержда).{0,25}(?:коллег|наставник|автор)/.test(clause)
        || /(?:сказали|написали|сообщили),?\s+что|(?:^|\s)по словам\s/.test(clause);
      return { clause, qualified };
    }).filter(({ clause }) => clause.length > 0);
  });
}

export function reviewClaims(run: Run, query: string, extracted?: string[]) {
  const price = run.kind === 'price-order';
  const archive = Boolean(run.task.comparison);
  const filteredPrimary = run.task.comparison?.checks[0].id === 'active-only';
  const scopeOf = (text: string) => searchScope(text, filteredPrimary);
  const scope = scopeOf(query);
  const mainId = archive ? 'all-statuses' : 'without-city';
  const controlId = archive ? 'active-only' : 'kazan';
  const checks = price ? run.checks : run.checks.filter(({ id }) => scope === 'control' ? id === controlId
    : scope === 'main' ? id === mainId : true);
  const clauses = reviewClauses(query);
  const scoped = clauses.map(({ clause, qualified }) => ({
    qualified, scope: scopeOf(clause),
    claims: price ? inferPrice(clause) : archive ? inferArchive(clause, scopeOf(clause) ?? scope, filteredPrimary)
      : inferCities(clause, scopeOf(clause) ?? scope),
  }));
  const claims = new Set(scoped.filter(({ qualified }) => !qualified).flatMap(({ claims }) => claims));
  const verdicts: ClaimVerdict[] = [];
  const sources = new Set<Run['checks'][number]['id']>();
  const observations = new Set<string>();
  for (const check of checks) {
    const tests: Record<string, readonly [boolean | undefined, string]> = 'ruleOrder' in check ? priceFacts(check) : (archive ? archiveFacts : cityFacts)(check);
    for (const claim of claims) {
      const negative = claim.startsWith('not-');
      const key = negative ? claim.slice(4) : claim;
      if (!Object.hasOwn(tests, key)) continue;
      const [confirmed, fact] = tests[key];
      const labels: Record<string, string> = price ? priceClaims : archive ? archiveClaims : cityClaims;
      const status = confirmed === undefined ? 'unclear' : confirmed !== negative ? 'confirmed' : 'refuted';
      const label = negative ? `неверно, что ${labels[key]}` : labels[key];
      verdicts.push({ status, text: `«${label}». ${fact}` });
      sources.add(check.id);
    }
    const neutral = scoped.filter(({ qualified, scope }) => qualified && (scope !== 'main' || check.id === mainId)
      && (scope !== 'control' || check.id === controlId));
    const keys = neutral.flatMap(({ claims }) => claims);
    // A model-only interpretation may point to evidence. It cannot attribute a claim to the trainee.
    if (!claims.size && !neutral.length) keys.push(...(extracted ?? []));
    const fallbackKey = price ? 'null-missing' : archive ? (check.id === controlId ? 'filtered-has-archive' : 'main-missing-archive')
      : check.id === controlId ? 'control-missing-samara' : 'main-missing-samara';
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
