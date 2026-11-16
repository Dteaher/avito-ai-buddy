import { useState } from 'react';
import { ArrowUpRight, ChevronDown, LoaderCircle, Sparkles } from 'lucide-react';
import type { TaskDraftInput, TaskTextSection } from '../shared/contracts';
import { errorMessage, post } from './api';

export function TaskSuggestion({ projectId, versionId, section, input, disabled, observation, onApply }: {
  projectId: string; versionId: string; section: TaskTextSection; input: TaskDraftInput; disabled: boolean;
  observation?: string;
  onApply: (text: string) => void;
}) {
  const [meaning, setMeaning] = useState('');
  const [suggestion, setSuggestion] = useState<{ basis: string; text: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const basis = JSON.stringify({ input, meaning: meaning.trim(), observation });
  const canSuggest = Boolean((meaning.trim() || observation) && input.checkIds.length);

  async function suggest() {
    if (busy || disabled || !canSuggest) return;
    setBusy(true);
    setError('');
    setSuggestion(undefined);
    try {
      const { text } = await post<{ text: string }>(`/api/mentor/tasks/${encodeURIComponent(projectId)}/clarification-suggestion`,
        { versionId, section, meaning, input });
      setSuggestion({ text, basis });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return <details className="response-details task-suggestion">
    <summary><span className="suggestion-mark"><Sparkles size={16} aria-hidden="true" /></span>
      Подготовить формулировку с Buddy <ChevronDown size={17} className="disclosure" aria-hidden="true" />
    </summary>
    <div className="task-suggestion-body">
      {observation && <p className="fact">{observation}</p>}
      <label className="editor-field">{observation ? 'Пояснение наставника (необязательно)' : 'Что нужно уточнить'}
        <textarea rows={2} maxLength={400} value={meaning} disabled={disabled || busy}
          onChange={(event) => setMeaning(event.target.value)} />
      </label>
      <button type="button" className="button secondary" disabled={disabled || busy || !canSuggest}
        aria-busy={busy} onClick={() => void suggest()}>
        {busy && <LoaderCircle size={16} className="spinner" aria-hidden="true" />}
        {busy ? 'Готовим правку…' : 'Предложить формулировку'}
      </button>
      {error && <p className="action-error" role="alert">{error}</p>}
      {suggestion && <div className="task-suggestion-result" aria-live="polite">
        {suggestion.basis === basis ? <>
          <dl><div><dt>Было</dt><dd>{input[section] || 'Пустое поле'}</dd></div>
            <div><dt>Предложение Buddy</dt><dd>{suggestion.text}</dd></div></dl>
          <button type="button" className="button primary" disabled={disabled} onClick={() => {
            onApply(suggestion.text);
            setSuggestion(undefined);
          }}>Вставить в черновик <ArrowUpRight size={16} aria-hidden="true" /></button>
        </> : <p className="fact">Черновик или пояснение изменились. Запроси новую формулировку.</p>}
      </div>}
    </div>
  </details>;
}
