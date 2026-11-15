import { checkRuleNumber, type BuddyAnswer, type CheckDraft, type DraftCheck, type Run, type Task } from '../shared/contracts.ts';
import { summarizeRun } from '../shared/run-summary.ts';
import { parseChecks, setPlan } from './scenario.ts';
import { parsePriceCheck, priceCheck, ruleOrder, sortTask } from './price-scenario.ts';
import { guideIntent, type Reply } from './buddy-guide.ts';
import type { WorkflowReply } from './buddy-model.ts';
import { archiveClaims, cityClaims, priceClaims, reviewClaims } from './conclusion-review.ts';

export function draftFor(task: Task, id: DraftCheck['id']): CheckDraft | undefined {
  if (task.id === sortTask.id) {
    if (id !== priceCheck.id) return;
    const order = parsePriceCheck({ checks: [{ id, expectedOrder: ruleOrder }] })!;
    return { checkId: id, path: priceCheck.path, checks: [{ id, expectedOrder: order }] };
  }
  const { checks } = setPlan(task);
  const selected = checks.find((check) => check.id === id);
  if (!selected) return;
  const input = checks.map(({ id, required }) => ({ id, expectedCities: required }));
  return { checkId: selected.id, path: selected.path, checks: parseChecks({ checks: input }, task)! };
}

export function workflowContract(task: Task, intent: WorkflowReply['intent'], guidance?: BuddyAnswer): WorkflowReply {
  const price = task.id === sortTask.id;
  const claims = price ? priceClaims : task.comparison ? archiveClaims : cityClaims;
  if (intent === 'review') return {
    intent, checks: [], claims: Object.keys(claims).flatMap((key) => [key, 'not-' + key]),
    hint: [
      'Извлеки только тезисы, которые стажёр сообщает как факт. Сохрани отрицание префиксом not-. Сомнение, вопрос, условие, причина и пересказ чужого мнения не являются тезисами стажёра. Если смысл неясен, верни claims=[].',
      'Верни kind=feedback, text="Вывод разобран" и claims, в котором только ID утверждений, явно сделанных стажёром. Если оба запроса работают, отметь main-correct и control-correct. Сохраняй привязку каждого утверждения к описанному запросу.',
      task.comparison ? 'Фразу «Без фильтра пропали архивные товары» обозначь как main-missing-archive, а «При status=active вернулись архивные» как filtered-has-archive. Для темы вне задачи верни insufficient, sources=[] и claims=[].'
        : 'Пример: «числа возрастают, значит порядок верный» даёт numeric-ascending и sort-correct. Для тезиса «карточка без цены пропала» верни null-missing, даже если тезис ложный. «карточка без цены не пропала» даёт not-null-missing. Аналогично «Самары нет» даёт main-missing-samara. Для темы вне задачи верни insufficient, sources=[] и claims=[].',
      `Утверждения: ${JSON.stringify(claims)}`,
    ].join('\n'),
  };
  const selected = guidance?.draft?.checkId;
  const clarificationRequired = !price && guidance?.kind === 'clarification';
  const selections: WorkflowReply['checks'] = price ? [{ id: 'price-asc', expected: ruleOrder }]
    : setPlan(task).checks.filter(({ id }) => !selected || id === selected).map(({ id, required }) => ({ id, expected: required }));
  return {
    intent, checks: selections, clarificationRequired, draftRequired: Boolean(selected),
    hint: [
      'Стажёр описывает предполагаемую проверку своими словами. Верни draft, если можно выбрать запрос. Признай верную часть ожидания, объясни ошибку или уточни, чего не хватает.',
      'В draft укажи один checkId и его expected из каталога в заданном порядке. Это ожидаемое по правилу, даже если стажёр предложил другое. Указывай номер пункта по выбранному запросу.',
      task.comparison ? `Критерий: ${task.criterion} Запрос для проверки поручения: ${task.comparison.checks[0].id}. Пункт 1 — общая выдача, пункт 2 — status=active.`
        : 'Для SORT-01 объясни, зачем учитывать объявление без цены. Для SEARCH-01 при неизвестном фильтре задай один вопрос: был ли запрос без фильтра или с city=kazan. Упоминание Казани в ответе не означает, что город задан в запросе.',
      'Для clarification и insufficient передай пустые checkId, expected и sources.',
      clarificationRequired
        ? `Фильтр неизвестен. Ответ: ${JSON.stringify({ kind: 'clarification', text: guidance?.text, checkId: '', expected: [], sources: [] })}`
        : `Пример структуры черновика: ${JSON.stringify({ kind: 'draft',
          text: 'Кратко объясни правило и оцени предположение стажёра.',
          checkId: selections[0].id, expected: selections[0].expected, sources: [`rule:${checkRuleNumber(selections[0].id)}`] })}`,
      `Каталог разрешённых ожиданий: ${JSON.stringify(selections)}`,
    ].join(' '),
  };
}

export function guidePlan(task: Task, query: string, followUp?: Reply['followUp']): BuddyAnswer | undefined {
  if (task.comparison) {
    const [diagnostic, baseline] = task.comparison.checks;
    const filtered = /status\s*=\s*active|фильтр по активн|запрос по активн/.test(query);
    const unfiltered = /без (?:фильтра|параметр)|фильтра не было|общ.{0,10}выдач|полн.{0,8}список/.test(query)
      || (followUp === 'filter' && /^нет[.!? ]*$/.test(query));
    let checkId: CheckDraft['checkId'] | undefined;
    if (/достаточно|хватит|как выбрать запрос/.test(query)) checkId = diagnostic.id;
    else if (unfiltered) checkId = 'all-statuses';
    else if (filtered) checkId = 'active-only';
    else if (/контроль/.test(query)) checkId = baseline.id;
    else if (/архив/.test(query)) checkId = diagnostic.id;
    if (!checkId) {
      if (/активн|одн.{0,6}групп/.test(query)) return {
        kind: 'clarification', text: 'Запрос был без фильтра или с status=active?', mode: 'guide', sources: [],
      };
      return;
    }
    return { kind: 'draft', mode: 'guide', draft: draftFor(task, checkId), text: inventoryDraftText(task, checkId),
      sources: [{ instructionId: task.instruction.id, ruleNumber: checkRuleNumber(checkId) }] };
  }
  const price = task.id === sortTask.id;
  const search = guideIntent(query, followUp);
  const currencyOrder = /500.{0,25}900/.test(query);
  const noPrice = /без цены|цена (?:не указана|неизвестна)|null/.test(query);
  const sorting = /сортир|дешев|возрастан|900.{0,25}500|числов.{0,15}цен|порядок цен|price_asc/.test(query)
    && !/по (?:дате|рейтингу|популярности|расстоянию)|по убыванию/.test(query);
  const clearNoFilter = /без (?:фильтр|город|выбора города|ограничения по городу)|не (?:задавал|ставил|указал|выбирал|добавлял) (?:фильтр|город)|не передаю параметр|чистый url|url был чистый|город не задан|фильтра не было/.test(query);
  const clearFilter = /city\s*=\s*kazan|фильтр.{0,18}казан|поиск по казани/.test(query);
  const checkId = price
    ? (currencyOrder || noPrice || sorting ? 'price-asc' : undefined)
    : clearNoFilter || search === 'no-city' ? 'without-city' : clearFilter || search === 'kazan' ? 'kazan' : undefined;
  if (!checkId) {
    if (!price && /казан|город|населенн.{0,12}пункт|одн.{0,8}локаци|^да[.!?]*$|^нет[.!?]*$/.test(query)) return {
      kind: 'clarification', text: 'Каким был запрос: без фильтра по городу или с city=kazan?', sources: [], mode: 'guide',
    };
    return;
  }
  const text = checkId === 'price-asc'
    ? `${pricePlanNote(query) ?? (currencyOrder ? '500 ₽ перед 900 ₽ — верно.' : 'Проверь позиции всех трёх объявлений.')} По пункту 2 карточка без цены остаётся в выдаче и должна стоять последней.`
    : checkId === 'without-city'
      ? /пуст/.test(query)
        ? 'Без фильтра выдача по пункту 1 должна содержать Казань и Самару. Пустой список расходится с правилом.'
        : 'Казань входит в ожидание. Без фильтра пункт 1 требует также Самару: один город может означать, что запрос ошибочно фильтрует выдачу.'
      : 'При city=kazan ожидается только Казань по пункту 2. Сравни состав выдачи с этим ожиданием.';
  return { kind: 'draft', text, mode: 'guide', draft: draftFor(task, checkId),
    sources: [{ instructionId: task.instruction.id, ruleNumber: checkId === 'without-city' ? 1 : 2 }] };
}

export function inventoryDraftText(task: Task, id: DraftCheck['id']) {
  const number = checkRuleNumber(id);
  const comparison = task.comparison?.checks[0].id === 'active-only'
    ? 'Общая выдача подтверждает, что архивные товары есть на стенде. Чтобы проверить, исключает ли их фильтр, выполни запрос с status=active.'
    : 'Успешный контроль по активным товарам проверяет фильтр. Чтобы обнаружить пропажу архивных товаров, нужен запрос без фильтра.';
  return `Пункт ${number}. ${task.instruction.rules[number - 1]} ${comparison}`;
}

export function pricePlanNote(query: string) {
  if (/без цены|без ценника|null/.test(query) && !/не (?:исключ|убер|убират|отброс|выки)/.test(query)
    && /исключ|убер|убрат|игнорир|отброс|выки/.test(query)) {
    return `${/500.{0,25}900/.test(query) ? '500 ₽ перед 900 ₽ — верно. ' : ''}Исключение противоречит инструкции. В черновике добавлю карточку без цены последней.`;
  }
  if (/только.{0,20}(?:числов|500|две цены|цен[ыу])/.test(query)) {
    return 'Проверка двух цен пропустит неверную позицию карточки без цены. В черновике сравним все три позиции.';
  }
  if (/(?:без цены|без ценника).{0,32}(?:последн|в конце|после всех)|(?:в конце|последн|дальше|затем).{0,32}без цены/.test(query)
    && !/не (?:став|остав|в конце|последн)|перв/.test(query)) {
    return 'Верно. В черновике проверим, что карточка без цены остаётся в конце.';
  }
}

export function guideFeedback(run: Run, query: string, claims?: string[]): BuddyAnswer {
  const { verdicts, ids, hypothesis } = reviewClaims(run, query, claims);
  const sources = run.checks.filter(({ id }) => ids.has(id)).flatMap(({ id, label }) => [
    { runId: run.id, checkId: id, label },
    { instructionId: run.task.instruction.id, ruleNumber: checkRuleNumber(id) },
  ]);
  const labels = { confirmed: 'Подтверждено', refuted: 'Опровергнуто', observation: 'Наблюдение', unclear: 'Нужно уточнение' };
  const text = [...verdicts.map(({ status, text }) => `${labels[status]} · ${text}`), hypothesis].filter(Boolean).join(' ');
  return { kind: 'feedback', mode: 'guide', text, verdicts, note: hypothesis || undefined, sources,
    facts: summarizeRun(run).filter((_, index) => ids.has(run.checks[index].id)) };
}

export function escalation(task: Task, query = '') {
  if (/отгул|отпуск/.test(query)) return 'Привет! Подскажи, где описан порядок оформления отгула или отпуска и кому направить запрос?';
  return `Привет! Я выполняю первую проверку ${task.id}. Подскажи, пожалуйста, к кому обратиться с вопросом, для которого нет ответа в инструкции команды?`;
}
