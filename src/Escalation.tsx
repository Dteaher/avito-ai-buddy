import { useState } from 'react';

export function Escalation({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return (
    <details className="response-details escalation">
      <summary>Вопрос наставнику</summary>
      <p>{text}</p>
      <button type="button" className="button secondary" onClick={() => void copy()}>Скопировать вопрос</button>
      {copied && <p role="status">Скопировано. Отправь вопрос наставнику в рабочем чате.</p>}
      {failed && <p role="alert">Выдели текст вопроса и скопируй его вручную.</p>}
    </details>
  );
}
