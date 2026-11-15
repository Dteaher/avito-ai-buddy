import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { BuddyAnswer, BuddyQuestion, Run } from '../shared/contracts';
import { errorMessage, post } from './api';
import { Escalation } from './Escalation';
import { formatTime } from './Evidence';

export function Conclusion({ run, value, onChange, openRule, mode, evidenceAnchor = 'result-evidence', label = 'Твой вывод', context }: {
  run: Run; value: string; onChange: (value: string) => void;
  mode?: BuddyQuestion['mode']; openRule: (rule: number) => void;
  evidenceAnchor?: string;
  label?: string;
  context?: string;
}) {
  const field = useId();
  const [feedback, setFeedback] = useState<{ question: string; mode?: BuddyQuestion['mode']; answer: BuddyAnswer }>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);

  async function check() {
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(true);
    setError('');
    try {
      const answer = await post<BuddyAnswer>(`/api/tasks/${run.task.id}/buddy`, {
        question: value.trim(), runId: run.id, intent: 'review', mode,
      }, controller.signal);
      if (!controller.signal.aborted) setFeedback({ question: value.trim(), mode, answer });
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const answer = feedback?.question === value.trim() && feedback.mode === mode ? feedback.answer : undefined;
  return (
    <section className="conclusion" aria-labelledby={`${field}-title`}>
      <h3 id={`${field}-title`}><label htmlFor={field}>{label}</label></h3>
      {context && <p className="fact">Сверка · {context} · <time dateTime={run.checkedAt}>{formatTime(run.checkedAt)}</time> · <code>{run.id.slice(0, 8)}</code></p>}
      <textarea id={field} value={value} maxLength={1000} rows={2}
        placeholder="Что подтвердилось и где есть расхождение?"
        onChange={(event) => { onChange(event.target.value); setError(''); }} />
      {mode !== 'manual' && (
        <button type="button" className="button secondary" disabled={pending || !value.trim() || value.trim().length > 500}
          onClick={() => void check()}>
          {pending ? 'Buddy сверяет вывод…' : 'Сверить вывод с Buddy'} {pending && <LoaderCircle className="spinner" size={16} />}
        </button>
      )}
      {mode !== 'manual' && value.trim().length > 500 && <p className="fallback-note">Для сверки с Buddy сократи вывод до 500 символов.</p>}
      {mode !== 'manual' && pending && <p className="visually-hidden" role="status">Сверяем вывод с сохранённым прогоном.</p>}
      {mode !== 'manual' && error && <p role="alert" className="action-error">{error}</p>}
      {mode !== 'manual' && answer && <div className="feedback" aria-live="polite">
        {answer.mode === 'guide-fallback' && <p className="fallback-note">Ответ из демо-справки. Модель не вернула проверенный ответ.</p>}
        {answer.verdicts?.length ? <>
          <ul className="claim-verdicts">{answer.verdicts.map(({ status, text }, index) => (
            <li key={index} data-status={status}><strong>{{ confirmed: 'Подтверждено', refuted: 'Опровергнуто', observation: 'Наблюдение', unclear: 'Уточнить' }[status]}</strong><p>{text}</p></li>
          ))}</ul>
          {answer.note && <p>{answer.note}</p>}
        </> : <p>{answer.text}</p>}
        {answer.facts?.map((fact) => <p key={fact} className="fact">{fact}</p>)}
        <div className="source-links">
          {answer.sources.filter((source) => !('runId' in source) || source.runId === run.id).map((source) => 'runId' in source
            ? <a key={source.checkId} className="text-link" href={`#${evidenceAnchor}-${source.checkId}`} onClick={() => {
              const target = document.getElementById(`${evidenceAnchor}-${source.checkId}`);
              let disclosure = target?.closest('details');
              while (disclosure) {
                disclosure.open = true;
                disclosure = disclosure.parentElement?.closest('details') ?? null;
              }
            }}>Ответ стенда · {source.label} <ArrowUpRight size={15} /></a>
            : <button key={source.ruleNumber} type="button" className="source-link" onClick={() => openRule(source.ruleNumber)}>
              Тестовая инструкция · пункт {source.ruleNumber} <ArrowUpRight size={15} />
            </button>)}
        </div>
        {answer.escalation && <Escalation text={answer.escalation} />}
      </div>}
    </section>
  );
}
