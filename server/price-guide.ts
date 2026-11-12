import { replies, type Reply } from './buddy-guide.ts';

const wholeOrder = 'В подготовке проверки собери весь порядок: 500 ₽ → 900 ₽ → без цены. Затем сравни позиции всех трёх объявлений в ответе.';
const noPrice = 'Объявление без цены остаётся в выдаче и стоит в конце. Поставь его на третье место в ожидании. Если в ответе оно первым, это расхождение по порядку.';

export const priceReplies = {
  'whole-order': { kind: 'guidance', rules: [1, 2], text: `Две числовые цены могут идти по возрастанию, даже если объявление без цены стоит раньше них. ${wholeOrder}` },
  'no-price': { kind: 'guidance', rules: [2], text: noPrice },
  status: { kind: 'guidance', rules: [3, 1, 2], text: `HTTP 200 подтверждает обработку запроса. Проверь последовательность объявлений. ${wholeOrder}` },
  'ask-price': { kind: 'clarification', rules: [], followUp: 'price', text: 'Есть ли цена у первого объявления? Если есть, какая?' },
  clarify: { kind: 'clarification', rules: [], text: 'Уточни, что проверяешь в SORT-01 — порядок числовых цен или место объявления без цены?' },
  insufficient: { kind: 'insufficient', rules: [], text: 'В тестовой инструкции SORT-01 нет сведений об этом. Она описывает сортировку по цене и место объявления без цены.' },
  action: { ...replies.action, text: 'Задай ожидаемый порядок объявлений и нажми «Запустить проверку». По ответу стенда сверь позиции. После просмотра результата можешь подтвердить публикацию.' },
} satisfies Record<string, Reply>;

export function priceIntent(query: string, followingUp: boolean): keyof typeof priceReplies {
  if (/сортиров.{0,24}по (?:дате|рейтингу|популярности|расстоянию)|по убыванию|от дорогих к дешевым/.test(query)) return 'insufficient';
  if (/\b200\b|статус (?:ответа|запроса)|код ответа/.test(query)) return 'status';
  if (/без цен|не указал[аи]? цен|цен[аыу] не (?:указан|задан)|цены нет|null/.test(query) || (followingUp && /^нет[.!?]*$/.test(query))) return 'no-price';
  if (followingUp && /\b(?:500|900)\b/.test(query)) return 'whole-order';
  if (/перв(?:ое|ый|ым|ом|ая).{0,30}(?:объявлен|мест|позици)/.test(query)) return 'ask-price';
  if (/сортиров|возрастан|дешев.{0,20}дорог|\b500\b.*\b900\b|\b900\b.*\b500\b/.test(query)) return 'whole-order';
  if (/^(?:что (?:делать|проверить|дальше)|как проверить|подскажи|помоги|да|нет)[.!? ]*$/.test(query)) return 'clarify';
  return 'insufficient';
}
