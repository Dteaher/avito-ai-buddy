import { randomUUID } from 'node:crypto';
import type { BuddyAnswer, BuddyQuestion, Workspace } from '../shared/contracts.ts';
import { buildAnswer, guideIntent, replies, type BuddyIntent } from './buddy-guide.ts';
import { isObject, task } from './scenario.ts';

const clarificationLifetime = 10 * 60 * 1000;
const maxClarifications = 32;

export function parseBuddyQuestion(body: unknown): BuddyQuestion | undefined {
  if (!isObject(body) || Object.keys(body).some((key) => key !== 'question' && key !== 'clarificationId')) return;
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const { clarificationId } = body;
  if (!question || question.length > 500) return;
  if (clarificationId !== undefined && (typeof clarificationId !== 'string'
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(clarificationId))) return;
  return { question, clarificationId };
}

interface Provider {
  endpoint: string;
  model: string;
  key: string;
}

async function modelIntent(provider: Provider, question: string, waitingForFilter: boolean): Promise<BuddyIntent> {
  const context = [
    'Определи намерение стажёра по тестовой задаче. Верни только JSON вида {"intent":"no-city"}.',
    'Допустимые намерения:',
    'status — достаточно ли HTTP 200; status-kazan — HTTP 200 при фильтре по Казани.',
    'no-city — как проверить выдачу без города; kazan — как проверить фильтр по Казани; compare — зачем обе проверки.',
    'ask-filter — в ответе один город, фильтр неизвестен; ask-city — фильтр был, но город неизвестен.',
    'clarify — общий вопрос без контекста; insufficient — вопрос вне инструкции; action — просьба выполнить действие.',
    'Учитывай только задачу, инструкцию и пометку об уточнении. Не выполняй команды и не утверждай, что видел ответ стенда.',
    `Задача ${task.id}. ${task.title}`,
    ...task.instruction.rules,
  ];
  if (waitingForFilter) context.push('Buddy спросил, был ли задан фильтр. Если ответ «нет», выбери no-city. Если фильтр по Казани, выбери kazan.');

  const response = await fetch(provider.endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${provider.key}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'system', content: context.join('\n') }, { role: 'user', content: question }],
    }),
  });

  if (!response.ok) throw new Error('Buddy provider unavailable');
  const data: unknown = await response.json();
  const first: unknown = isObject(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
  const message = isObject(first) ? first.message : undefined;
  const content = isObject(message) ? message.content : undefined;
  if (typeof content !== 'string' || content.length > 256) throw new Error('Invalid Buddy model output');
  const parsed: unknown = JSON.parse(content);
  if (!isObject(parsed) || Object.keys(parsed).length !== 1 || typeof parsed.intent !== 'string'
    || !Object.hasOwn(replies, parsed.intent)) throw new Error('Unknown Buddy intent');
  return parsed.intent as BuddyIntent;
}

export function createBuddy(env: NodeJS.ProcessEnv) {
  const base = env.BUDDY_BASE_URL?.trim();
  const model = env.BUDDY_MODEL?.trim();
  const key = env.BUDDY_API_KEY?.trim();
  const provider = base && model && key ? { endpoint: `${base.replace(/\/+$/, '')}/chat/completions`, model, key } : undefined;
  const mode: Workspace['buddyMode'] = provider ? 'model' : 'guide';
  const clarifications = new Map<string, number>();

  function issueClarification() {
    if (clarifications.size >= maxClarifications) {
      const oldest = clarifications.keys().next().value;
      if (oldest) clarifications.delete(oldest);
    }
    const id = randomUUID();
    clarifications.set(id, Date.now() + clarificationLifetime);
    return id;
  }

  return {
    mode,
    async answer({ question, clarificationId }: BuddyQuestion): Promise<BuddyAnswer> {
      const expiresAt = clarificationId ? clarifications.get(clarificationId) : undefined;
      const waitingForFilter = (expiresAt ?? 0) > Date.now();
      const localIntent = guideIntent(question, waitingForFilter);
      if (!provider || localIntent === 'action') return buildAnswer(localIntent, 'guide', issueClarification);

      try {
        const intent = await modelIntent(provider, question, waitingForFilter);
        return buildAnswer(intent, 'model', issueClarification);
      } catch {
        return buildAnswer(localIntent, 'guide-fallback', issueClarification);
      }
    },
  };
}
