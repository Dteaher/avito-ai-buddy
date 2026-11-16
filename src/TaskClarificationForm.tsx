import { useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { taskClarificationSections, type TaskClarification } from '../shared/contracts';
import { errorMessage, post } from './api';

export function TaskClarificationForm({ taskId, version, initial, hidden }: {
  taskId: string; version: string; initial?: TaskClarification | null; hidden: boolean;
}) {
  const [saved, setSaved] = useState(initial);
  const [note, setNote] = useState<TaskClarification>(initial ?? { section: 'criterion', text: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const text = note.text.trim();
  const unchanged = saved?.section === note.section && saved.text === text;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !text || unchanged) return;
    setBusy(true);
    setError('');
    try {
      const sent = await post<TaskClarification>(`/api/tasks/${encodeURIComponent(taskId)}/clarification`, { section: note.section, text });
      setSaved(sent);
      setNote(sent);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return <details className="response-details task-clarification" hidden={hidden}>
    <summary>{saved ? `Вопрос по версии ${version} отправлен` : 'Что непонятно в поручении?'} <ChevronDown size={16} className="disclosure" /></summary>
    <form onSubmit={(event) => void send(event)}>
      <label className="editor-field">Что уточнить
        <select value={note.section} disabled={busy} onChange={(event) => setNote({ ...note, section: event.target.value as TaskClarification['section'] })}>
          {Object.entries(taskClarificationSections).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label className="editor-field">Вопрос наставнику
        <textarea rows={3} maxLength={400} value={note.text} disabled={busy} onChange={(event) => setNote({ ...note, text: event.target.value })} />
      </label>
      {error && <p className="action-error" role="alert">{error}</p>}
      <button type="submit" className="button secondary" disabled={busy || !text || unchanged}>
        {busy ? 'Отправляем…' : saved ? 'Обновить вопрос' : 'Отправить наставнику'}
      </button>
      <p className="fact" role="status">{saved && unchanged ? `Наставник увидит вопрос рядом с версией ${version}.` : ''}</p>
    </form>
  </details>;
}
