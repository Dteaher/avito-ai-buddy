import type { BuddyAnswer } from '../shared/contracts.ts';
import { checks, task } from './scenario.ts';

export interface Reply {
  kind: BuddyAnswer['kind'];
  text: string;
  rules: number[];
  followUp?: 'filter' | 'kazan' | 'price';
}

const [noCityRule, kazanRule, statusRule] = task.instruction.rules;
const [main, control] = checks.map(({ path }) => `GET ${path}`);
const mainStep = `В основном запросе ${main} отметь Казань и Самару и сверь города в теле ответа. Так проверишь, что стенд не отсекает объявления без фильтра.`;
const controlStep = `В контрольном запросе ${control} отметь только Казань и сверь города в теле ответа. Так проверишь, что фильтр применяется.`;

export const replies = {
  status: { kind: 'guidance', rules: [3, 1], text: `${statusRule}\n\n${mainStep}` },
  'status-kazan': { kind: 'guidance', rules: [3, 2], text: `${statusRule}\n\n${controlStep}` },
  'no-city': { kind: 'guidance', rules: [1], text: `${noCityRule}\n\n${mainStep}` },
  kazan: { kind: 'guidance', rules: [2], text: `${kazanRule}\n\n${controlStep}` },
  compare: {
    kind: 'guidance', rules: [2, 1],
    text: `Контрольный запрос ${control} проверяет, что фильтр оставляет только Казань. Основной ${main} проверяет, что без фильтра в выдаче есть Казань и Самара. Укажи ожидания для обоих запросов и сравни ответы.`,
  },
  'ask-filter': {
    kind: 'clarification', rules: [], followUp: 'filter',
    text: 'Был ли задан фильтр по городу? Уточни, это был запрос без города или с параметром city=kazan.',
  },
  'ask-city': {
    kind: 'clarification', rules: [], followUp: 'kazan',
    text: 'Уточни, был ли это фильтр по Казани. Для другого города в SEARCH-01 нет контрольного запроса.',
  },
  clarify: {
    kind: 'clarification', rules: [],
    text: 'Уточни, что проверяем в SEARCH-01 — выдачу без города, фильтр по Казани или содержимое ответа при HTTP 200?',
  },
  insufficient: {
    kind: 'insufficient', rules: [],
    text: 'В тестовой инструкции SEARCH-01 нет сведений об этом. По ней могу помочь с выдачей без города, фильтром по Казани и значением HTTP 200.',
  },
  action: {
    kind: 'action', rules: [],
    text: 'Выбери ожидаемые города и нажми «Запустить проверку». Затем сверь ответы, открой предпросмотр записи и нажми «Подтвердить публикацию». Итог появится после ответа стенда, а ссылка на запись — после подтверждения.',
  },
} satisfies Record<string, Reply>;

export type BuddyIntent = keyof typeof replies;

const withoutFilter = [
  /без (?:фильтра|(?:выбора |указания |параметра )?(?:город|city)|привязки к (?:городу|населенному пункту))/,
  /(?:город|city).{0,18}(?:не (?:выбран|задан|указан|передан|заполнен)|пуст|отсутств)/,
  /нет (?:параметра )?(?:city|города|фильтра)|фильтра не было|фильтр не (?:задан|указан|передан)/,
  /параметр.{0,18}не (?:передавал|отправлял|указал)/,
  /не (?:выбирал[аи]?|выбрал[аи]?|указал[аи]?|задавал[аи]?|передавал[аи]?) (?:город|city|фильтр)/,
];

export function isActionRequest(query: string) {
  return /(?:^|[^\p{L}])(?:опубликуй(?:те)?|запусти(?:те)?|подтверди(?:те)? публикацию|выполни(?:те)? (?:проверку|запрос)|сделай(?:те)? прогон)(?=$|[^\p{L}])/u.test(query)
    || /(?:^|[^\p{L}])(?:отправь|запиши)(?=$|[^\p{L}]).*(?:задач|трекер|проверк|прогон)/u.test(query)
    || /^(?:как|где|когда|можно ли|можешь) (?:мне )?(?:запустить|опубликовать)(?=$|[^\p{L}])/u.test(query);
}

export function guideIntent(query: string, followUp?: Reply['followUp']): BuddyIntent {
  const noCity = withoutFilter.some((pattern) => pattern.test(query));
  const mentionsKazan = /казан|kazan|контрольн/.test(query);
  const kazan = mentionsKazan && /city\s*=\s*kazan|контрольн|фильтр|поиск по казани|выбрал|указал|передал/.test(query);
  const status = /\b200\b|статус (?:ответа|запроса)|код ответа/.test(query);

  if (status) return kazan && !noCity ? 'status-kazan' : 'status';
  if (/(?:оба|обоих) запрос|два запрос|кажд(?:ом|ый) запрос/.test(query)) return 'compare';
  if (noCity && mentionsKazan && /оба|потом|контрольн/.test(query)) return 'compare';
  if (mentionsKazan && /достаточно|хватит|зачем|разниц|отлича/.test(query)) return 'compare';
  if (noCity) return 'no-city';
  if (kazan) return 'kazan';

  if (followUp) {
    if (/^нет[.!?]*$/.test(query)) return followUp === 'filter' ? 'no-city' : 'clarify';
    if (/^да[.!?]*$/.test(query) && followUp === 'kazan') return 'kazan';
    if (/не по казани/.test(query)) return 'ask-city';
    if (mentionsKazan) return 'kazan';
    if (/^да[.!?]*$|фильтр (?:был|задан|указан)/.test(query)) return 'ask-city';
  }

  if (/один (?:\S+ )?город|одного города|единственн.{0,10}город|(?:только|лишь) казань/.test(query)
    && /верну|выдач|ответ|результат|показа|пришел|получ|нормальн/.test(query)) return 'ask-filter';

  if (/^(?:что (?:делать|проверить|дальше)|как проверить|подскажи|помоги|не понимаю|да|нет)[.!? ]*$/.test(query)) return 'clarify';
  return 'insufficient';
}
