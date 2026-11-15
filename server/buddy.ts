import { randomUUID } from 'node:crypto';
import type { BuddyAnswer, BuddyQuestion, BuddySource, Run, Task, Workspace } from '../shared/contracts.ts';
import { buddyEvidence, guideRunAnswer } from './buddy-evidence.ts';
import { guideIntent, isActionRequest, replies, type Reply } from './buddy-guide.ts';
import { generateReply, ModelResponseError, readProvider, type DialogueMessage, type ReplyPlan } from './buddy-model.ts';
import { priceIntent, priceReplies } from './price-guide.ts';
import { sortTask } from './price-scenario.ts';
import { isObject } from './scenario.ts';
import { draftFor, escalation, guideFeedback, guidePlan, pricePlanNote, workflowContract } from './buddy-workflow.ts';

const clarificationLifetime = 10 * 60 * 1000;
const conversationLifetime = 30 * 60 * 1000;
const maxContexts = 32;
const maxTurns = 3;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const contextKeys = ['clarificationId', 'conversationId', 'runId'] as const;

export function parseBuddyQuestion(body: unknown): BuddyQuestion | undefined {
  if (!isObject(body)) return;
  const { question, intent, mode, ...context } = body;
  if (typeof question !== 'string' || !question.trim() || question.trim().length > 500) return;
  const input: BuddyQuestion = { question: question.trim() };
  if (intent !== undefined && intent !== 'plan' && intent !== 'review') return;
  if (mode !== undefined && mode !== 'guide' && mode !== 'manual') return;
  if (intent) input.intent = intent;
  if (mode) input.mode = mode;
  for (const [key, value] of Object.entries(context)) {
    const field = contextKeys.find((candidate) => candidate === key);
    if (!field || typeof value !== 'string' || !uuid.test(value)) return;
    input[field] = value;
  }
  return input;
}

interface Scope { taskId: string; owner: string; scope: string; expiresAt: number }
interface Clarification extends Scope { topic: NonNullable<Reply['followUp']> }
interface Turn { question: string; answer: string; kind: BuddyAnswer['kind']; sources: BuddySource[]; runId?: string }
interface Conversation extends Scope { turns: Turn[] }

function remember<T>(map: Map<string, T>, id: string, value: T) {
  map.delete(id);
  if (map.size >= maxContexts) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
  map.set(id, value);
}

function cite(sources: BuddySource[]) {
  return sources.map((source) => 'runId' in source ? `run:${source.checkId}` : `rule:${source.ruleNumber}`);
}

function needsRun(query: string) {
  return /еще не (?:запускал|запустил)|что (?:показал прогон|вернул (?:стенд|сервер|контрольный|основной) ?)/.test(query);
}

function planReply(query: string, guide: BuddyAnswer, local: Reply, price: boolean, last?: Turn, run?: Run): ReplyPlan | undefined {
  if (!run && needsRun(query)) {
    return { kind: 'insufficient', hint: 'Данных о прогоне пока нет. Предложи выполнить проверку и открыть результат.' };
  }
  if (guide.kind === 'guidance') {
    const aboutRun = guide.sources.some((source) => 'runId' in source);
    const priceRule = price && guide.sources.some((source) => 'ruleNumber' in source && source.ruleNumber === 2);
    const sourceIds = cite(guide.sources);
    const control = sourceIds.includes('run:kazan');
    const primary = sourceIds.includes('run:without-city');
    const onlyControl = control && !primary;
    const wrongExpectation = run?.checks.some((check) => !check.followsRule && sourceIds.includes(`run:${check.id}`));
    return {
      kind: 'guidance', sourceIds,
      required: !aboutRun && priceRule ? [/без цены/i, /в конце|последн|после/i] : undefined,
      forbidden: onlyControl ? [/без (?:города|фильтра)|город не (?:указан|задан)/i] : undefined,
      hint: aboutRun
        ? [
          primary && control && 'Опиши оба запроса. Сначала без города, затем контрольный с city=kazan. Укажи итог каждого сравнения.',
          onlyControl && 'Контрольный запрос был с city=kazan. Фильтр был задан.',
          wrongExpectation && 'Стажёр выбрал неверное ожидание. Назови отдельно, что выбрал стажёр, что вернул стенд и что требует инструкция.',
          `Сформулируй точный ответ по этим фактам. ${guide.text}`,
        ].filter(Boolean).join(' ')
        : `Дай прямой ответ и сохрани условия из подсказки. ${guide.text}${priceRule ? ' Отдельной фразой скажи, что объявления без цены остаются в конце выдачи.' : ''}`,
    };
  }
  if (local.followUp) return { kind: 'clarification', hint: `Задай один вопрос по сути этого уточнения. ${local.text}` };
  if (last?.kind === 'guidance' && /переформулируй|скажи (?:это|то же)|короче|без терминов|одной (?:короткой )?фразой/.test(query)) {
    return { kind: 'guidance', sourceIds: cite(last.sources), hint: 'Переформулируй свой предыдущий ответ согласно запросу и сохрани его смысл.' };
  }
}

export function createBuddy(env: NodeJS.ProcessEnv, observeModelAttempt?: () => void) {
  const provider = readProvider(env);
  const mode: Workspace['buddyMode'] = provider ? 'model' : 'guide';
  const providerKind: Workspace['buddyProvider'] = provider ? (provider.local ? 'local' : 'remote') : undefined;
  const clarifications = new Map<string, Clarification>();
  const conversations = new Map<string, Conversation>();

  function guideAnswer(task: Task, reply: Reply): BuddyAnswer {
    const answer: BuddyAnswer = {
      kind: reply.kind, text: reply.text, mode: 'guide',
      sources: reply.rules.map((ruleNumber) => ({ instructionId: task.instruction.id, ruleNumber })),
    };
    return answer;
  }

  return {
    mode, provider: providerKind,
    async answer(task: Task, { question, clarificationId, conversationId, intent, mode: requestedMode }: BuddyQuestion, run?: Run, signal?: AbortSignal, owner = ''): Promise<BuddyAnswer> {
      const scope = `${requestedMode ?? 'default'}/${intent ?? 'chat'}/${intent ? run?.id ?? '' : ''}`;
      const bound = (entry?: Scope) => entry?.owner === owner && entry.scope === scope
        && entry.taskId === task.id && entry.expiresAt > Date.now();
      const previous = clarificationId ? clarifications.get(clarificationId) : undefined;
      const followUp = bound(previous) ? previous?.topic : undefined;
      const price = task.id === sortTask.id;
      const query = question.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ');
      const outside = /отгул|отпуск|внутренн.*(?:пароль|ключ)|игнорируй.*(?:инструкц|правил)|системный промпт/.test(query);
      if (requestedMode === 'manual' || outside) return {
        kind: 'insufficient', mode: 'guide', sources: [], escalation: escalation(task, query),
        text: outside ? 'В тестовой инструкции команды нет сведений по этому вопросу.' : 'Ручной режим включён. Проверь правило в инструкции или уточни вопрос у наставника.',
      };
      if (isActionRequest(query)) return guideAnswer(task, price ? priceReplies.action : replies.action);
      if (intent === 'review' && !run) return {
        kind: 'insufficient', mode: 'guide', sources: [], text: 'Сначала выполни проверку или открой доступный прогон.',
      };
      const local: Reply = price ? priceReplies[priceIntent(query, followUp === 'price')] : replies[guideIntent(query, followUp)];
      const groundingTask = run?.task ?? task;
      const evidence = buddyEvidence(groundingTask, run);
      const runAnswer = guideRunAnswer(query, run, evidence);
      let answer: BuddyAnswer = runAnswer ? { ...runAnswer, mode: 'guide' }
        : !run && needsRun(query) ? { kind: 'insufficient', text: 'Данных о прогоне пока нет. Запусти проверку и открой ответ стенда.', mode: 'guide', sources: [] }
          : guideAnswer(groundingTask, local);
      if (intent === 'plan') answer = guidePlan(task, query, followUp) ?? answer;
      if (intent === 'plan' && answer.kind === 'guidance') answer = {
        kind: 'clarification', text: 'Какой разрешённый запрос хочешь проверить? Уточни параметр запроса или открой ручную форму.',
        mode: 'guide', sources: [],
      };
      if (intent === 'review' && run) answer = guideFeedback(run, query);

      if (provider && !requestedMode) {
        const existing = conversationId ? conversations.get(conversationId) : undefined;
        const active = bound(existing) ? existing : undefined;
        const id = active ? conversationId! : randomUUID();
        const turns = active?.turns.filter((turn) => !turn.runId || turn.runId === run?.id) ?? [];
        const selectedChecks = runAnswer?.sources.filter((source) => 'runId' in source);
        const selectedIds = selectedChecks ? new Set(cite(selectedChecks)) : undefined;
        const relatedTurns = selectedIds ? turns.filter(({ sources, runId }) => runId
          && sources.every((source) => !('runId' in source) || selectedIds.has(`run:${source.checkId}`))) : turns;
        const history = relatedTurns.flatMap(({ question, answer }): DialogueMessage[] => [
          { role: 'user', content: question }, { role: 'assistant', content: answer },
        ]);
        const hints = {
          price: 'Buddy спросил, есть ли цена у первого объявления. Если ответ «нет», объясни правило из rule:2.',
          filter: 'Buddy спросил, был ли задан фильтр. Если ответ «нет», объясни проверку без фильтра по rule:1.',
          kazan: 'Buddy уточнил, был ли задан фильтр по Казани. Ответ «нет» сам по себе не означает, что фильтра не было.',
        };
        try {
          const plan = intent ? undefined : planReply(query, answer, local, price, relatedTurns.at(-1), run);
          const relatedRules = selectedChecks?.flatMap(({ checkId }) => checkId === 'price-asc' ? ['rule:1', 'rule:2']
            : [checkId === 'without-city' ? 'rule:1' : 'rule:2']);
          const modelEvidence = selectedIds ? new Map([...evidence].filter(([id]) => selectedIds.has(id)
            || id === 'rule:3' || relatedRules?.includes(id))) : evidence;
          const workflow = intent ? workflowContract(groundingTask, intent, answer) : undefined;
          const timeout = workflow ? AbortSignal.timeout(provider.timeout) : undefined;
          const modelSignal = signal && timeout ? AbortSignal.any([signal, timeout]) : timeout ?? signal;
          const generate = async () => {
            observeModelAttempt?.();
            const response = await generateReply(provider, {
              task: groundingTask, question, evidence: intent ? evidence : modelEvidence,
              history: intent === 'review' ? [] : history, followUp: followUp && !history.length ? hints[followUp] : undefined,
              signal: modelSignal, plan, workflow,
            });
            if (intent === 'review' && response.kind === 'insufficient' && answer.verdicts?.some(({ status }) => status !== 'unclear')) {
              throw new ModelResponseError();
            }
            return response;
          };
          const { checkId, reviewClaims, ...generated } = await generate().catch((error: unknown) => {
            if (workflow && error instanceof ModelResponseError && !modelSignal?.aborted) return generate();
            throw error;
          });
          const text = checkId === 'price-asc'
            ? (answer.kind === 'draft' && pricePlanNote(query) ? answer.text
              : 'По пункту 2 карточку без цены оставляем в выдаче и ставим последней. Сравни позиции всех трёх карточек.')
            : generated.text;
          answer = {
            ...(generated.kind === 'feedback' && run ? guideFeedback(run, query, reviewClaims) : generated),
            ...(checkId ? { text } : {}),
            mode: 'model', ...(checkId ? { draft: draftFor(task, checkId) } : {}),
          };
        } catch (error) {
          signal?.throwIfAborted();
          answer = { ...answer, mode: 'guide-fallback', fallbackReason: error instanceof ModelResponseError ? 'invalid-response' : 'unavailable' };
        }
        signal?.throwIfAborted();
        answer.conversationId = id;
        remember(conversations, id, {
          taskId: task.id, owner, scope, expiresAt: Date.now() + conversationLifetime,
          turns: [...turns, { question, answer: answer.text, kind: answer.kind, sources: answer.sources, runId: run?.id }].slice(-maxTurns),
        });
      }

      const topic = intent === 'plan' && !price ? 'filter' : local.followUp;
      if (answer.kind === 'clarification' && (answer.mode !== 'model' || intent) && topic) {
        const id = randomUUID();
        remember(clarifications, id, { taskId: task.id, owner, scope, expiresAt: Date.now() + clarificationLifetime, topic });
        answer.clarificationId = id;
      }
      if (answer.kind === 'insufficient' && !needsRun(query)) answer.escalation = escalation(task, query);
      return answer;
    },
  };
}
