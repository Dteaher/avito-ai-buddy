import { checkRuleNumber, groupLabels, type BuddyAnswer, type BuddySource, type CheckResult, type Run, type Task } from '../shared/contracts.ts';
import { priceCheck, sortTask } from './price-scenario.ts';
import { setPlan } from './scenario.ts';
import { summarizeRun } from '../shared/run-summary.ts';

export interface EvidenceEntry {
  source: BuddySource;
  facts: string;
}

function cityList(list: CheckResult['actualCities']) {
  return list.map((city) => groupLabels[city]).join(', ') || 'пусто';
}

function summarize(check: CheckResult) {
    if (!check.followsRule) {
      const actualMatchesRule = check.actualCities.length === check.ruleCities.length
        && check.ruleCities.every((city) => check.actualCities.includes(city));
      return `Стажёр выбрал — ${cityList(check.expectedCities)}. Стенд вернул — ${cityList(check.actualCities)}. По инструкции требуется — ${cityList(check.ruleCities)}. Ответ стенда ${actualMatchesRule ? 'соответствует' : 'противоречит'} инструкции.`;
    }
    const missing = check.missing.length ? ` Отсутствуют города из ожидания — ${cityList(check.missing)}.` : '';
    const extra = check.extra.length ? ` Лишние города — ${cityList(check.extra)}.` : '';
    return `Ожидание — ${cityList(check.expectedCities)}. Фактически — ${cityList(check.actualCities)}.${missing}${extra}`;
}

export function buddyEvidence(task: Task, run?: Run) {
  const evidence = new Map<string, EvidenceEntry>();
  const requests = run?.checks ?? (task.id === sortTask.id ? [priceCheck] : setPlan(task).checks);
  task.instruction.rules.forEach((rule, index) => {
    const ruleNumber = index + 1;
    const check = requests[index];
    const facts = check ? `${rule} Разрешённый запрос — GET ${check.path}.` : rule;
    evidence.set(`rule:${ruleNumber}`, { source: { instructionId: task.instruction.id, ruleNumber }, facts });
  });
  if (run) for (const [index, check] of run.checks.entries()) {
    const result = check.matches ? 'Совпало с ожиданием.' : 'Расхождение с ожиданием.';
    const rule = check.followsRule ? 'Ожидание соответствует инструкции прогона.' : 'Ожидание расходится с инструкцией прогона.';
    evidence.set(`run:${check.id}`, {
      source: { runId: run.id, checkId: check.id, label: check.label },
      facts: 'actualOrder' in check || run.task.comparison ? `${summarizeRun(run)[index]} ${rule}` : `GET ${check.path} · HTTP ${check.status}. ${summarize(check)} ${result} ${rule}`,
    });
  }
  return evidence;
}

export function guideRunAnswer(query: string, run: Run | undefined, evidence: Map<string, EvidenceEntry>): Pick<BuddyAnswer, 'kind' | 'text' | 'sources'> | undefined {
  if (!run || !/прогон|расхожд|фактич|итог|сырой|отчет|пропал[аи]? из ответа|сдвинул|что (?:было|пришло) в (?:контрольн|основн)|что вернул (?:стенд|контрольн|основн)|результат (?:стенда|проверки)|стенд (?:вернул|показал)/.test(query)) return;
  const [primary, control] = run.checks;
  let relevant: Run['checks'][number][] = [primary];
  if (control) {
    const mentionsPrimary = /основн|без (?:города|фильтра)/.test(query);
    const mentionsControl = /контроль|city\s*=\s*kazan|status\s*=\s*active|фильтр по казани/.test(query);
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
    const rule = evidence.get(`rule:${checkRuleNumber(check.id)}`);
    if (rule) entries.push(rule);
  }
  return { kind: 'guidance', text: entries.map(({ facts }) => facts).join('\n\n'), sources: entries.map(({ source }) => source) };
}
