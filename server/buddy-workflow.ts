import type { BuddyAnswer, CheckDraft, DraftCheck, PriceResult, Run, Task } from '../shared/contracts.ts';
import { summarizeRun } from '../shared/run-summary.ts';
import { checks, parseChecks, ruleCities } from './scenario.ts';
import { parsePriceCheck, priceCheck, ruleOrder, sortTask } from './price-scenario.ts';
import { guideIntent, type Reply } from './buddy-guide.ts';
import type { WorkflowReply } from './buddy-model.ts';

export function draftFor(task: Task, id: DraftCheck['id']): CheckDraft | undefined {
  if (task.id === sortTask.id) {
    if (id !== priceCheck.id) return;
    const order = parsePriceCheck({ checks: [{ id, expectedOrder: ruleOrder }] })!;
    return { checkId: id, path: priceCheck.path, checks: [{ id, expectedOrder: order }] };
  }
  const selected = checks.find((check) => check.id === id);
  if (!selected) return;
  const input = checks.map(({ id }) => ({ id, expectedCities: ruleCities[id] }));
  return { checkId: selected.id, path: selected.path, checks: parseChecks({ checks: input })! };
}

const priceClaims = {
  'numeric-ascending': 'числовые цены возрастают',
  'sort-correct': 'вся сортировка работает, включая объявление без цены',
  'null-first': 'объявление без цены на первом месте',
  'null-last': 'объявление без цены в конце',
  'null-missing': 'объявление без цены отсутствует',
};
const cityClaims = {
  'main-correct': 'состав выдачи без фильтра правильный',
  'control-correct': 'состав выдачи с фильтром Казань правильный',
  'main-missing-samara': 'Самара отсутствует без фильтра',
  'control-missing-samara-is-defect': 'отсутствие Самары в фильтре Казань является дефектом',
};

export function workflowContract(task: Task, intent: WorkflowReply['intent'], run?: Run, guidance?: BuddyAnswer): WorkflowReply {
  const price = task.id === sortTask.id;
  const claims = price ? priceClaims : cityClaims;
  if (intent === 'review') return {
    intent, checks: [], claims: Object.keys(claims),
    hint: [
      'Извлеки утверждения из текста стажёра, не оценивай их истинность. Сервер проверит их по прогону.',
      'Верни kind=feedback, text="Вывод разобран" и claims, в котором только ID утверждений, явно сделанных стажёром. Если оба запроса работают, отметь main-correct и control-correct. Если стажёр упоминает контрольный запрос, не приписывай ему вывод о запросе без фильтра.',
      'Укажи источники run: по теме вывода. Для темы вне задачи верни insufficient, sources=[] и claims=[].',
      `Утверждения: ${JSON.stringify(claims)}. Факты сервера: ${run ? summarizeRun(run).join(' ') : ''}`,
    ].join('\n'),
  };
  const selected = guidance?.draft?.checkId;
  const clarificationRequired = !price && guidance?.kind === 'clarification';
  const selections: WorkflowReply['checks'] = price ? [{ id: 'price-asc', expected: ruleOrder }]
    : checks.filter(({ id }) => !selected || id === selected).map(({ id }) => ({ id, expected: ruleCities[id] }));
  return {
    intent, checks: selections, clarificationRequired,
    hint: [
      'Стажёр описывает предполагаемую проверку своими словами. Верни draft, если можно выбрать запрос. Признай верную часть ожидания, объясни ошибку или уточни, чего не хватает.',
      'В draft укажи один checkId и его expected из каталога в заданном порядке. Это ожидаемое по правилу, даже если стажёр предложил другое. Обязательно укажи rule:2 для price-asc и kazan или rule:1 для without-city.',
      'Для SORT-01 объясни, зачем учитывать объявление без цены. Для SEARCH-01 при неизвестном фильтре задай один вопрос: был ли запрос без фильтра или с city=kazan. Упоминание Казани в ответе не означает, что город задан в запросе.',
      'Для clarification и insufficient передай пустые checkId, expected и sources.',
      clarificationRequired
        ? 'Фильтр неизвестен. Ответ: {"kind":"clarification","text":"Каким был запрос: без фильтра или с city=kazan?","checkId":"","expected":[],"sources":[]}'
        : `Пример структуры черновика: ${JSON.stringify({ kind: 'draft',
          text: 'Кратко объясни правило и оцени предположение стажёра.',
          checkId: selections[0].id, expected: selections[0].expected, sources: [price ? 'rule:2' : 'rule:1'] })}`,
      `Каталог разрешённых ожиданий: ${JSON.stringify(selections)}`,
    ].join(' '),
  };
}

export function guidePlan(task: Task, query: string, followUp?: Reply['followUp']): BuddyAnswer | undefined {
  const price = task.id === sortTask.id;
  const search = guideIntent(query, followUp);
  const currencyOrder = /500.{0,25}900/.test(query);
  const noPrice = /без цены|цена (?:не указана|неизвестна)|null/.test(query);
  const sorting = /сортир|дешев|возрастан|900.{0,25}500/.test(query)
    && !/по (?:дате|рейтингу|популярности|расстоянию)|по убыванию/.test(query);
  const clearNoFilter = /без (?:фильтр|город|выбора города)|не (?:задавал|ставил|указал|выбирал) (?:фильтр|город)|не передаю параметр|город не задан|фильтра не было/.test(query);
  const clearFilter = /city\s*=\s*kazan|фильтр.{0,18}казан|поиск по казани/.test(query);
  const checkId = price
    ? (currencyOrder || noPrice || sorting ? 'price-asc' : undefined)
    : clearNoFilter || search === 'no-city' ? 'without-city' : clearFilter || search === 'kazan' ? 'kazan' : undefined;
  if (!checkId) {
    if (!price && /казан|город|^да[.!?]*$|^нет[.!?]*$/.test(query)) return {
      kind: 'clarification', text: 'Каким был запрос: без фильтра по городу или с city=kazan?', sources: [], mode: 'guide',
    };
    return;
  }
  const text = checkId === 'price-asc'
    ? statesRequiredPriceOrder(query)
      ? 'Ожидание согласуется с инструкцией: 500 ₽ → 900 ₽ → без цены. Проверь все три позиции. Пункт 2 требует оставить объявление без цены последним.'
      : `${currencyOrder ? '500 ₽ перед 900 ₽ — верно. ' : ''}Проверь весь порядок: 500 ₽ → 900 ₽ → без цены. По пункту 2 карточка без цены остаётся в выдаче и должна стоять последней. Если её исключить, ошибка в её позиции останется незамеченной.`
    : checkId === 'without-city'
      ? /пуст/.test(query)
        ? 'Без фильтра выдача по пункту 1 должна содержать Казань и Самару. Пустой список расходится с правилом.'
        : 'Казань входит в ожидание. Без фильтра пункт 1 требует также Самару: один город может означать, что запрос ошибочно фильтрует выдачу.'
      : 'При city=kazan ожидается только Казань по пункту 2. Сравни состав выдачи с этим ожиданием.';
  return { kind: 'draft', text, mode: 'guide', draft: draftFor(task, checkId),
    sources: [{ instructionId: task.instruction.id, ruleNumber: checkId === 'without-city' ? 1 : 2 }] };
}

export function statesRequiredPriceOrder(query: string) {
  return /500.{0,25}900.{0,30}(?:дальше|после|→|затем|последн|в конце).{0,32}без цены/.test(query)
    && !/(?:убрать|исключить|игнорировать|не ставить|отбросить)/.test(query);
}

function priceFeedback(check: PriceResult, query: string, claims?: string[]) {
  const noPriceItems = check.items.filter(({ price }) => price === null);
  const firstUnpriced = check.items.findIndex(({ price }) => price === null);
  const prices = check.items.flatMap(({ price }) => price === null ? [] : [price]);
  const numericOrder = prices.length > 1 && prices.every((value, index) => index === 0 || prices[index - 1] <= value);
  const orderedByRule = check.actualOrder.length === check.ruleOrder.length
    && check.ruleOrder.every((id, index) => id === check.actualOrder[index]);
  const mentionsFirst = claims ? claims.includes('null-first') : /без цены.{0,30}(?:перв|начал)|(?:перв|начал).{0,30}без цены/.test(query);
  const claimsMissing = claims ? claims.includes('null-missing') : /пропал|отсутств|исчез/.test(query);
  const acknowledgesOrder = claims ? claims.includes('numeric-ascending') : /500|900|числов|сортиров/.test(query);
  const first = firstUnpriced === 0 ? 'на первом месте' : `на позиции ${firstUnpriced + 1}`;
  if (orderedByRule) return 'Стенд вернул порядок по инструкции. В выводе можно опереться на последовательность ниже.';
  if (!noPriceItems.length) return 'Факт расхождения: стенд не вернул объявление без цены, которое должно остаться в выдаче по пункту 2.';
  if (claimsMissing) return `Объявление без цены присутствует ${first}. Проверь в выводе его позицию по пункту 2.`;
  if (mentionsFirst && firstUnpriced === 0 && !claims?.includes('sort-correct')) {
    return `${numericOrder && acknowledgesOrder ? 'Вывод отражает оба факта: цены возрастают, а карточка без цены пришла первой.' : 'Замечание о первом месте подтверждается.'} По правилу карточка должна идти после объявлений с ценой.`;
  }
  return `${numericOrder ? 'Числовые цены действительно возрастают. ' : ''}Сверь вывод с инструкцией: карточка без цены ${first}. По пункту 2 она должна идти после объявлений с ценой.`;
}

export function guideFeedback(run: Run, query: string, claims?: string[]): BuddyAnswer {
  const facts = summarizeRun(run);
  let text: string;
  let relevant: Run['checks'][number][] = run.checks;
  if (run.kind === 'price-order') {
    text = priceFeedback(run.checks[0], query, claims);
  } else {
    const [main, control] = run.checks;
    const mentionsControl = /контрол|фильтр (?:по казан|казан)|city\s*=\s*kazan/.test(query);
    const mentionsMain = /без (?:фильтр|город)|основн/.test(query);
    const mentionsBoth = /оба|обоих/.test(query) || (mentionsControl && mentionsMain);
    const controlOnly = !mentionsBoth && (mentionsControl || (!mentionsMain && claims?.length
      && claims.every((claim) => claim.startsWith('control-'))));
    const mainOnly = !mentionsBoth && (mentionsMain || (!mentionsControl && claims?.length
      && claims.every((claim) => claim.startsWith('main-'))));
    const missingSamara = main.ruleCities.includes('samara') && !main.actualCities.includes('samara');
    const controlMatches = control.actualCities.length === control.ruleCities.length && control.ruleCities.every((city) => control.actualCities.includes(city));
    if (controlOnly) relevant = [control];
    else if (mainOnly) relevant = [main];
    const acknowledgesMissing = claims?.includes('main-missing-samara') ?? /самар.{0,25}(?:нет|отсутств)|(?:нет|отсутств|не хватает).{0,25}самар/.test(query);
    const mainText = missingSamara
      ? `${acknowledgesMissing ? 'Подтверждается: без фильтра отсутствует Самара.' : 'Без фильтра пришла только часть ожидаемой выдачи: Самара отсутствует.'} По пункту 1 должны прийти Казань и Самара.`
      : 'Сверь состав ответа без фильтра с пунктом 1 инструкции.';
    const controlText = controlMatches
      ? 'Контрольный запрос с фильтром по Казани соответствует пункту 2: он должен вернуть только Казань.'
      : 'Состав ответа с фильтром отличается от пункта 2, где ожидается только Казань.';
    text = [!controlOnly && mainText, !mainOnly && controlText].filter(Boolean).join(' ');
  }
  const sources = relevant.flatMap(({ id, label }) => [
    { runId: run.id, checkId: id, label },
    { instructionId: run.task.instruction.id, ruleNumber: id === 'without-city' ? 1 : 2 },
  ]);
  return { kind: 'feedback', mode: 'guide', text, sources, facts };
}

export function escalation(task: Task) {
  return `Привет! Я выполняю первую проверку ${task.id}. Подскажи, пожалуйста, к кому обратиться с вопросом, для которого нет ответа в инструкции команды?`;
}
