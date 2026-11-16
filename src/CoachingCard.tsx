import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, ChevronDown, LoaderCircle, Sparkles } from 'lucide-react';
import type { BuddySource, CheckDraft, CoachedConclusion, CoachingReply } from '../shared/contracts';
import { errorMessage, post } from './api';
import { openResponse } from './Evidence';

const topicLabels: Record<CoachingReply['topic'], string> = {
  query: 'Выбор запроса', expectation: 'Ожидание по правилу', interpretation: 'Как прочитан ответ',
  evidence: 'Доказательство из ответа', ready: 'Готовность к эксперименту',
};

function modeLabel(mode: CoachingReply['mode']) {
  const labels = { model: 'Модель Buddy', guide: 'Демо-справка', 'guide-fallback': 'Резервная подсказка' };
  return labels[mode];
}

function CoachingSources({ sources, openRule }: { sources: BuddySource[]; openRule: (rule: number) => void }) {
  return <div className="source-links">
    {sources.map((source) => 'runId' in source
      ? <a key={source.checkId} className="text-link" href={`#result-evidence-${source.checkId}`}
        onClick={() => openResponse(`result-evidence-${source.checkId}`)}>Ответ стенда · {source.label} <ArrowUpRight size={15} /></a>
      : <button key={source.ruleNumber} type="button" className="source-link" onClick={() => openRule(source.ruleNumber)}>
        <BookOpen size={15} /> Правило · пункт {source.ruleNumber}
      </button>)}
  </div>;
}

export function CoachingCard({ taskId, context, mode, disabled, openRule, onDraft }: {
  taskId: string; context: { attemptId: string } | { runId: string; conclusion: string };
  mode?: 'guide'; disabled?: boolean; openRule: (rule: number) => void; onDraft?: (draft: CheckDraft, question: string) => void;
}) {
  const heading = useId();
  const before = 'attemptId' in context;
  const subject = before ? '' : context.conclusion.trim();
  const [state, setState] = useState<{ note: CoachingReply; subject: string }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function requestCoaching() {
    if (pending || disabled) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError('');
    try {
      const note = await post<CoachingReply>(`/api/tasks/${encodeURIComponent(taskId)}/coaching`,
        before ? { ...context, mode } : { ...context, conclusion: subject, mode }, controller.signal);
      if (!controller.signal.aborted) {
        setState({ note, subject });
        setApplied(false);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const note = state?.note;
  const action = before ? 'Разобрать выбор с Buddy' : 'Разобрать результат с Buddy';
  return <section className="coach-card" aria-labelledby={heading}>
    <header className="coach-heading">
      <span className="coach-mark"><Sparkles size={21} aria-hidden="true" /></span>
      <div><h3 id={heading}>{before ? 'Разбор первого выбора' : 'Разбор результата'}</h3>
        <p>{before ? 'Buddy подскажет, что проверить на основе твоего первого выбора.'
          : 'Buddy сопоставит твой вывод с правилом и сохранённым ответом стенда.'}</p>
      </div>
    </header>
    {note && <div className="coach-answer" key={note.question} aria-live="polite">
      <div className="coach-meta"><strong>{topicLabels[note.topic]}</strong><span>{modeLabel(note.mode)}</span></div>
      {note.fallbackReason && <p className="fact">{note.fallbackReason === 'unavailable'
        ? 'Модель пока недоступна. Можно продолжить с локальной подсказкой.' : 'Подсказка построена по сохранённому правилу и данным проверки.'}</p>}
      <p className="coach-question">{note.question}</p>
      {!before && state.subject !== subject && <p className="fact">Подсказка по предыдущему выводу.</p>}
      <details className="response-details coach-proof">
        <summary>Подсказка и доказательства <ChevronDown size={16} className="disclosure" /></summary>
        <div>
          <p>{note.explanation}</p>
          <p className="coach-fact">{note.fact}</p>
          <CoachingSources sources={note.sources} openRule={openRule} />
        </div>
      </details>
      {note.draft && onDraft && <button type="button" className="button primary" disabled={disabled || pending || applied} onClick={() => {
        if (!note.draft) return;
        onDraft(note.draft, note.question);
        setApplied(true);
      }}>{applied ? 'Запрос в форме' : 'Подготовить запрос'} <ArrowRight size={17} /></button>}
    </div>}
    {error && <p className="action-error" role="alert">{error}</p>}
    {(!note || !before || note.mode === 'guide-fallback') && <button type="button" className="button secondary coach-action"
      disabled={disabled || pending} aria-busy={pending} onClick={() => void requestCoaching()}>
      {pending ? <><LoaderCircle size={17} className="spinner" aria-hidden="true" /> Buddy разбирает попытку…</>
        : note ? 'Разобрать ещё раз' : action}
    </button>}
    {pending && <p className="visually-hidden" role="status">Buddy готовит разбор по сохранённым фактам.</p>}
  </section>;
}

export function CoachingTrace({ before, after, conclusion, openRule }: {
  before?: CoachingReply; after?: CoachedConclusion; conclusion?: string; openRule: (rule: number) => void;
}) {
  if (!before && !after) return null;
  const firstReview = after?.initial ?? after;
  return <section className="coach-trace" aria-label="Подсказки Buddy в этой попытке">
    <h3><Sparkles size={18} aria-hidden="true" /> Подсказки Buddy в этой попытке</h3>
    {before && <div className="coach-trace-step">
      <span className="fact">До запуска · {modeLabel(before.mode)}</span>
      <p><strong>{before.question}</strong></p>
      <p>{before.fact}</p>
      <CoachingSources sources={before.sources} openRule={openRule} />
    </div>}
    {firstReview && <div className="coach-trace-step">
      <span className="fact">После ответа стенда · {modeLabel(firstReview.note.mode)}</span>
      {firstReview.conclusion && firstReview.conclusion !== conclusion && <p><strong>Вывод до подсказки</strong> · {firstReview.conclusion}</p>}
      <p><strong>{firstReview.note.question}</strong></p>
      <p>{firstReview.note.fact}</p>
      <CoachingSources sources={firstReview.note.sources} openRule={openRule} />
      {after?.initial && <p className="fact">Повторный разбор · {modeLabel(after.note.mode)} · {after.note.question}</p>}
      {firstReview.conclusion && conclusion && firstReview.conclusion !== conclusion && <p><strong>Вывод в записи</strong> · {conclusion}</p>}
    </div>}
  </section>;
}
