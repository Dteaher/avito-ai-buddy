import { useState } from 'react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { BuddyAnswer, BuddyQuestion, Run } from '../shared/contracts';
import { errorMessage, post } from './api';
import { Escalation } from './Escalation';

export function Conclusion({ run, value, onChange, openRule, mode }: {
  run: Run; value: string; onChange: (value: string) => void;
  mode?: BuddyQuestion['mode']; openRule: (rule: number) => void;
}) {
  const [feedback, setFeedback] = useState<{ question: string; mode?: BuddyQuestion['mode']; answer: BuddyAnswer }>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function check() {
    setPending(true);
    setError('');
    try {
      const answer = await post<BuddyAnswer>(`/api/tasks/${run.task.id}/buddy`, {
        question: value.trim(), runId: run.id, intent: 'review', mode,
      });
      setFeedback({ question: value.trim(), mode, answer });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  const answer = feedback?.question === value.trim() && feedback.mode === mode ? feedback.answer : undefined;
  return (
    <section className="conclusion" aria-labelledby="conclusion-title">
      <h3 id="conclusion-title"><label htmlFor="conclusion">Твой вывод</label></h3>
      <textarea id="conclusion" value={value} maxLength={1000} rows={2}
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
        <p>{answer.text}</p>
        {answer.facts?.map((fact) => <p key={fact} className="fact">{fact}</p>)}
        <div className="source-links">
          {answer.sources.map((source) => 'runId' in source
            ? <a key={source.checkId} className="text-link" href="#result-evidence">Ответ стенда · {source.label} <ArrowUpRight size={15} /></a>
            : <button key={source.ruleNumber} type="button" className="source-link" onClick={() => openRule(source.ruleNumber)}>
              Тестовая инструкция · пункт {source.ruleNumber} <ArrowUpRight size={15} />
            </button>)}
        </div>
        {answer.escalation && <Escalation text={answer.escalation} />}
      </div>}
    </section>
  );
}
