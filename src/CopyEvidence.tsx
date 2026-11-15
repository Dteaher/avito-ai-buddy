import { useId, useState } from 'react';
import { Copy } from 'lucide-react';
import type { Publication } from '../shared/contracts';
import { summarizeRun } from '../shared/run-summary';

export function CopyEvidence({ publication }: { publication: Publication }) {
  const id = useId();
  const [status, setStatus] = useState<'copied' | 'manual'>();
  const { run, conclusion, url, tracker } = publication;
  const evidence = [
    `${run.task.id} · ${run.task.title}`,
    `Правило ${run.task.instruction.id} v${run.task.instruction.version}`,
    `Снимок ${run.id}`,
    ...(tracker?.status === 'delivered' ? [`Квитанция трекера ${tracker.id}`] : []),
    ...summarizeRun(run),
    `Вывод: ${conclusion || '—'}`,
    new URL(url, window.location.origin).href,
  ].join('\n');
  async function copy() {
    try {
      await navigator.clipboard.writeText(evidence);
      setStatus('copied');
    } catch {
      setStatus('manual');
    }
  }
  return (
    <div className="copy-evidence">
      <button type="button" className="text-link" onClick={() => void copy()}><Copy size={15} /> Копировать доказательство</button>
      {status === 'copied' && <p className="fact" role="status">Скопировано со ссылкой на эту версию записи.</p>}
      {status === 'manual' && <><label htmlFor={id}>Доказательство для копирования</label><textarea id={id} value={evidence} readOnly rows={6} /></>}
    </div>
  );
}
