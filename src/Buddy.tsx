import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUp, ArrowUpRight, BookOpen, ChevronDown, LoaderCircle, Sparkles, Terminal, X } from 'lucide-react';
import { cities, type BuddyAnswer, type BuddyQuestion, type CheckDraft, type Instruction, type PriceListing, type Run, type RunEvidenceSource, type Workspace } from '../shared/contracts';
import { errorMessage, post, request } from './api';
import { Evidence, formatTime } from './Evidence';
import { Escalation } from './Escalation';

const suggestions = ['Ответа 200 достаточно?', 'Как проверить поиск без города?', 'Что вернёт фильтр по Казани?'];
const priceSuggestions = ['Достаточно, что 500 и 900 идут по порядку?', 'Куда поставить объявление без цены?'];

interface Props {
  workspace: Pick<Workspace, 'task' | 'kind' | 'buddyMode' | 'buddyProvider'>;
  openSource: (ruleNumber?: number) => void;
  run?: Run;
  collapsible?: boolean;
  intent?: 'plan';
  mode?: BuddyQuestion['mode'];
  onDraft?: (draft: CheckDraft, question: string) => void;
  orderItems?: PriceListing[];
}

type EvidenceDialogState = { source: RunEvidenceSource; run?: Run; error?: string };

export function Buddy({ workspace, openSource, run, collapsible = false, intent, mode, onDraft, orderItems }: Props) {
  const { task, buddyMode } = workspace;
  const [messages, setMessages] = useState<{ question: string; intent?: 'plan'; mode?: BuddyQuestion['mode']; answer?: BuddyAnswer }[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const [evidence, setEvidence] = useState<EvidenceDialogState>();
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const log = useRef<HTMLDivElement>(null);
  const evidenceDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = log.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pending, failure, expanded]);

  async function ask(question: string, keepDraft = false, requestedIntent?: 'plan') {
    const text = question.trim();
    if (!text || pending) return;
    const related = messages.filter((message) => message.intent === requestedIntent && message.mode === mode);
    const previous = related.findLast(({ answer }) => answer)?.answer;
    const conversationId = related.findLast(({ answer }) => answer?.conversationId)?.answer?.conversationId;
    const input: BuddyQuestion = { question: text, clarificationId: previous?.clarificationId, conversationId,
      runId: requestedIntent ? undefined : run?.id, intent: requestedIntent, mode };
    const exchange = { question: text, intent: requestedIntent, mode };
    setFailure('');
    setPending(true);
    setMessages((previous) => [
      ...previous.filter(({ answer }) => answer),
      exchange,
    ]);
    if (!keepDraft) setDraft('');

    try {
      const answer = await post<BuddyAnswer>(`/api/tasks/${task.id}/buddy`, input);
      setMessages((previous) => [...previous.slice(0, -1), { ...exchange, answer }]);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft, false, intent);
  }

  async function openEvidence(source: RunEvidenceSource) {
    setEvidence({ source, run: run?.id === source.runId ? run : undefined });
    evidenceDialog.current?.showModal();
    if (run?.id === source.runId) return;
    try {
      const snapshot = await request<Run>(`/api/tasks/${task.id}/runs/${source.runId}`);
      setEvidence((previous) => previous?.source === source ? { source, run: snapshot } : previous);
    } catch (error) {
      setEvidence((previous) => previous?.source === source ? { source, error: errorMessage(error) } : previous);
    }
  }

  if (mode === 'manual') return (
    <aside className="surface buddy manual-panel" aria-label="Без Buddy">
      <h2>Без Buddy</h2>
      <button type="button" className="text-link" onClick={() => openSource()}>Открыть инструкцию <ArrowUpRight size={16} /></button>
      <Escalation text={`Привет! Я выполняю первую проверку ${task.id}. Подскажи, пожалуйста, к кому обратиться с вопросом, для которого нет ответа в инструкции команды?`} />
    </aside>
  );

  return (
    <aside className="buddy surface" aria-labelledby="buddy-title" data-expanded={collapsible ? expanded : undefined}>
      <div className="buddy-header">
        <div className="buddy-identity"><span className="buddy-mark"><Sparkles size={21} /></span><h2 id="buddy-title" tabIndex={-1}>AI-buddy</h2></div>
        <span className="buddy-mode">{mode === 'guide' || buddyMode === 'guide' ? 'Демо-справка' : workspace.buddyProvider === 'local' ? 'Локальная LLM' : 'LLM'}</span>
        {collapsible && <button className="buddy-toggle" type="button" aria-expanded={expanded} aria-controls={bodyId}
          onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Свернуть' : 'Спросить'} <ChevronDown size={16} />
        </button>}
      </div>
      <div className="buddy-body" id={bodyId}>
        {run && (
          <div className="buddy-context">
            <button className="text-link" type="button" disabled={pending} onClick={() => void ask(run.kind === 'price-order'
              ? 'Что показал прогон?' : 'Что вернул каждый из двух запросов в моём прогоне и где расхождение?', true)}>Разобрать результат <ArrowUpRight size={14} /></button>
          </div>
        )}
        <div className="chat-log" ref={log} role="log" aria-label="Диалог с Buddy">
          {!messages.length && (
            <div className="welcome">
              <p className="bubble assistant">{workspace.kind === 'price-order'
                ? 'Попробуй задать порядок по инструкции. Если сомневаешься, спроси меня.'
                : 'Помогу разобраться в задаче и сверить ожидания с правилами команды. С чего начнём?'}</p>
              <div className="suggestions">
                {(workspace.kind === 'price-order' ? priceSuggestions : suggestions).map((question) => (
                  <button key={question} type="button" onClick={() => void ask(question, true)}>{question}<ArrowUpRight size={15} /></button>
                ))}
              </div>
            </div>
          )}
          {messages.map(({ question, answer, mode: answerMode }, index) => (
            <div className="chat-exchange" key={index}>
              <p className="bubble question">{question}</p>
              {answer?.mode === 'guide-fallback' && <p className="fallback-note">{answer.fallbackReason === 'invalid-response'
                ? 'Ответ модели не прошёл проверку. Показана демо-справка.' : 'Модель недоступна. Ответ из демо-справки.'}</p>}
              {answer?.sources.some((source) => 'runId' in source && source.runId !== run?.id) && <p className="fallback-note">Ответ по предыдущему прогону</p>}
              {answer && <p className="bubble assistant">{answer.text}</p>}
              {answer?.draft && <div className="draft-preview">
                <code>GET {answer.draft.path}</code>
                <p>{answer.draft.checks.filter(({ id }) => id === answer.draft?.checkId).map((check) => 'expectedOrder' in check
                  ? check.expectedOrder.map((id) => {
                    const item = orderItems?.find((entry) => entry.id === id);
                    return item?.price == null ? 'без цены' : `${item.price} ₽`;
                  }).join(' → ') : check.expectedCities.map((city) => cities[city]).join(' · '))}</p>
                {onDraft && mode === answerMode && !run && <button type="button" className="button secondary"
                  onClick={() => { setExpanded(false); onDraft(answer.draft!, question); }}>Использовать черновик</button>}
              </div>}
              {answer?.escalation && <Escalation text={answer.escalation} />}
              {!!answer?.sources.length && (
                <div className="source-links">
                  {answer.sources.map((source) => 'runId' in source ? (
                    <button key={`${source.runId}-${source.checkId}`} type="button" className="source-link" onClick={() => void openEvidence(source)}>
                      <Terminal size={16} /><span>Ответ стенда · {source.label}</span><ArrowUpRight size={15} />
                    </button>
                  ) : (
                    <button key={`${source.instructionId}-${source.ruleNumber}`} type="button" className="source-link" onClick={() => openSource(source.ruleNumber)}>
                      <BookOpen size={16} /><span>Тестовая инструкция · пункт {source.ruleNumber}</span><ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              )}
              {answer?.mode === 'guide-fallback' && !answer.sources.length && (
                <button type="button" className="source-link" onClick={() => openSource()}><BookOpen size={16} /> Открыть тестовую инструкцию</button>
              )}
            </div>
          ))}
          {pending && <p className="bubble assistant pending" role="status"><LoaderCircle size={17} className="spinner" /> Buddy отвечает…</p>}
          {failure && (
            <div className="bubble assistant" role="alert">
              <p>{failure}</p>
              <button type="button" className="text-link" onClick={() => void ask(messages.at(-1)!.question, true, messages.at(-1)!.intent)}>Повторить <ArrowRight size={16} /></button>
            </div>
          )}
        </div>
        <form className="chat-form" onSubmit={send}>
          <textarea aria-label="Спросить Buddy" placeholder={intent ? 'Как ты хочешь проверить задачу?' : 'Спросить Buddy'} value={draft} rows={1} maxLength={500}
            onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void ask(draft, false, intent);
              }
            }} />
          <button type="submit" aria-label="Отправить вопрос" title="Отправить вопрос" disabled={pending || !draft.trim()}>
            <ArrowUp size={22} />
          </button>
        </form>
      </div>
      <dialog ref={evidenceDialog} className="instruction-dialog evidence-dialog" aria-labelledby="evidence-title">
        <div className="dialog-content">
          <form method="dialog" className="dialog-close">
            <button type="submit" className="icon-button" aria-label="Закрыть ответ стенда"><X size={20} /></button>
          </form>
          <span className="test-guide"><Terminal size={16} /> Сохранённый прогон · {task.id}</span>
          <h2 id="evidence-title">{evidence?.source.label ?? 'Ответ стенда'}</h2>
          {evidence?.run && <>
            <p><time dateTime={evidence.run.checkedAt}>{formatTime(evidence.run.checkedAt)}</time></p>
            <Evidence run={evidence.run} checkId={evidence.source.checkId} />
          </>}
          {evidence?.error && <p role="alert">{evidence.error}</p>}
          {evidence && !evidence.run && !evidence.error && <p role="status">Загружаем прогон…</p>}
        </div>
      </dialog>
    </aside>
  );
}

export function InstructionDialog({ instruction, dialog }: { instruction: Instruction; dialog: React.RefObject<HTMLDialogElement | null> }) {
  return (
    <dialog ref={dialog} className="instruction-dialog" aria-labelledby="instruction-title">
      <div className="dialog-content">
        <form method="dialog" className="dialog-close">
          <button type="submit" className="icon-button" aria-label="Закрыть инструкцию"><X size={20} /></button>
        </form>
        <span className="test-guide"><BookOpen size={16} /> Тестовая инструкция</span>
        <h2 id="instruction-title">{instruction.title}</h2>
        <p>{instruction.team} · версия {instruction.version}</p>
        <ol>{instruction.rules.map((rule, index) => <li key={rule} data-rule-number={index + 1} tabIndex={-1}>{rule}</li>)}</ol>
      </div>
    </dialog>
  );
}

export function showInstruction(dialog: HTMLDialogElement | null, ruleNumber?: number) {
  if (!dialog) return;
  dialog.showModal();
  if (ruleNumber !== undefined) dialog.querySelector<HTMLElement>(`[data-rule-number="${ruleNumber}"]`)?.focus();
}
