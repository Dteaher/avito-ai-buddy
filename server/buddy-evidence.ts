import { cities, type BuddyAnswer, type BuddySource, type CheckResult, type PriceResult, type Run, type Task } from '../shared/contracts.ts';
import { priceCheck, sortTask } from './price-scenario.ts';
import { checks } from './scenario.ts';

export interface EvidenceEntry {
  source: BuddySource;
  facts: string;
}

function cityList(list: CheckResult['actualCities']) {
  return list.map((city) => cities[city]).join(', ') || 'пусто';
}

function priceOrder(check: PriceResult, kind: 'expectedOrder' | 'actualOrder') {
  const items = kind === 'actualOrder' ? check.items : check.fixtures;
  return check[kind].slice(0, 12).map((id) => {
    const item = items.find((candidate) => candidate.id === id);
    return `${id} (${item?.price == null ? 'без цены' : `${item.price} ₽`})`;
  }).join(' → ') || 'пусто';
}

function summarize(check: CheckResult | PriceResult) {
  if ('expectedCities' in check) {
    if (!check.followsRule) {
      const actualMatchesRule = check.actualCities.length === check.ruleCities.length
        && check.ruleCities.every((city) => check.actualCities.includes(city));
      return `Стажёр выбрал — ${cityList(check.expectedCities)}. Стенд вернул — ${cityList(check.actualCities)}. По инструкции требуется — ${cityList(check.ruleCities)}. Ответ стенда ${actualMatchesRule ? 'соответствует' : 'противоречит'} инструкции.`;
    }
    const missing = check.missing.length ? ` Отсутствуют города из ожидания — ${cityList(check.missing)}.` : '';
    const extra = check.extra.length ? ` Лишние города — ${cityList(check.extra)}.` : '';
    return `Ожидание — ${cityList(check.expectedCities)}. Фактически — ${cityList(check.actualCities)}.${missing}${extra}`;
  }
  const composition = check.sameItems ? 'Состав совпал.' : 'Состав выдачи отличается.';
  const withoutPrice = check.fixtures.find(({ price }) => price === null)?.id;
  const expectedPosition = withoutPrice ? check.expectedOrder.indexOf(withoutPrice) + 1 : 0;
  const actualPosition = withoutPrice ? check.actualOrder.indexOf(withoutPrice) + 1 : 0;
  const position = expectedPosition && actualPosition
    ? ` Место объявления без цены в ожидании — ${expectedPosition}, в ответе — ${actualPosition}.` : '';
  return `Ожидаемый порядок — ${priceOrder(check, 'expectedOrder')}. Фактический — ${priceOrder(check, 'actualOrder')}. ${composition}${position}`;
}

export function buddyEvidence(task: Task, run?: Run) {
  const evidence = new Map<string, EvidenceEntry>();
  const requests = run?.checks ?? (task.id === sortTask.id ? [priceCheck] : checks);
  task.instruction.rules.forEach((rule, index) => {
    const ruleNumber = index + 1;
    const check = requests[index];
    const facts = check ? `${rule} Разрешённый запрос — GET ${check.path}.` : rule;
    evidence.set(`rule:${ruleNumber}`, { source: { instructionId: task.instruction.id, ruleNumber }, facts });
  });
  if (run) for (const check of run.checks) {
    const result = check.matches ? 'Совпало с ожиданием.' : 'Расхождение с ожиданием.';
    const rule = check.followsRule ? 'Ожидание соответствует инструкции прогона.' : 'Ожидание расходится с инструкцией прогона.';
    evidence.set(`run:${check.id}`, {
      source: { runId: run.id, checkId: check.id, label: check.label },
      facts: `GET ${check.path} · HTTP ${check.status}. ${summarize(check)} ${result} ${rule}`,
    });
  }
  return evidence;
}

export function guideRunAnswer(query: string, run: Run | undefined, evidence: Map<string, EvidenceEntry>): Pick<BuddyAnswer, 'kind' | 'text' | 'sources'> | undefined {
  if (!run || !/прогон|расхожд|фактич|итог|сырой|отчет|пропал[аи]? из ответа|сдвинул|что (?:было|пришло) в (?:контрольн|основн)|что вернул (?:стенд|контрольн|основн)|результат (?:стенда|проверки)|стенд (?:вернул|показал)/.test(query)) return;
  const [primary, control] = run.checks;
  let relevant: (CheckResult | PriceResult)[] = [primary];
  if (control) {
    const mentionsPrimary = /основн|без (?:города|фильтра)/.test(query);
    const mentionsControl = /контроль|city\s*=\s*kazan|фильтр по казани/.test(query);
    if ((mentionsPrimary && mentionsControl) || /оба|дв[ае]|кажд|запросы|что показал прогон/.test(query)) relevant = [primary, control];
    else if (mentionsControl) relevant = [control];
    else if (!mentionsPrimary && /расхожд/.test(query)) {
      const mismatches = [primary, control].filter(({ matches }) => !matches);
      relevant = mismatches.length ? mismatches : [primary, control];
    } else if (!mentionsPrimary) relevant = [primary, control];
  }
  const entries = relevant.map(({ id }) => evidence.get(`run:${id}`)!);
  const status = /\b200\b|код ответа|статус/.test(query) ? evidence.get('rule:3') : undefined;
  if (status) entries.unshift(status);
  for (const check of relevant.filter(({ followsRule }) => !followsRule)) {
    const rule = evidence.get(check.id === 'without-city' ? 'rule:1' : 'rule:2');
    if (rule) entries.push(rule);
  }
  return { kind: 'guidance', text: entries.map(({ facts }) => facts).join('\n\n'), sources: entries.map(({ source }) => source) };
}
