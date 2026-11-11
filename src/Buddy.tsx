import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUp, ArrowUpRight, BookOpen, LoaderCircle, Sparkles, X } from 'lucide-react';
import type { BuddyAnswer, Instruction, Publication, Workspace } from '../shared/contracts';
import { errorMessage, post } from './api';

const suggestions = ['Ответа 200 достаточно?', 'Как проверить поиск без города?', 'Что вернёт фильтр по Казани?'];

interface Props {
  workspace: Workspace;
  openSource: () => void;
  publication?: Publication;
}

export function Buddy({ workspace, openSource, publication }: Props) {
  const { task, buddyMode } = workspace;
  const [messages, setMessages] = useState<{ question: string; answer?: BuddyAnswer }[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = log.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pending, failure, publication]);

  async function ask(question: string, retry = false) {
    const text = question.trim();
    if (!text || pending) return;
    setFailure('');
    setPending(true);
    setMessages((previous) => [
      ...previous.filter(({ answer }) => answer),
      { question: text },
    ]);
    if (!retry) setDraft('');

    try {
      const answer = await post<BuddyAnswer>(`/api/tasks/${task.id}/buddy`, { question: text });
      setMessages((previous) => [...previous.slice(0, -1), { question: text, answer }]);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft);
  }

  return (
    <aside className="buddy surface" aria-labelledby="buddy-title">
      <div className="buddy-header">
        <div className="buddy-identity"><span className="buddy-mark"><Sparkles size={21} /></span><h2 id="buddy-title">AI-buddy</h2></div>
        <span className="buddy-mode">{buddyMode === 'guide' ? 'Демо-справка' : 'Режим модели'}</span>
      </div>
      <div className="chat-log" ref={log} role="log" aria-label="Диалог с Buddy">
        {!messages.length && (
          <div className="welcome">
            <p className="bubble assistant">Помогу разобраться в задаче и сверить ожидания с правилами команды. С чего начнём?</p>
            <div className="suggestions">
              {suggestions.map((question) => (
                <button key={question} type="button" onClick={() => void ask(question)}>{question}<ArrowUpRight size={15} /></button>
              ))}
            </div>
          </div>
        )}
        {messages.map(({ question, answer }, index) => (
          <div className="chat-exchange" key={index}>
            <p className="bubble question">{question}</p>
            {answer && <p className="bubble assistant">{answer.text}</p>}
            {answer?.sourceId === task.instruction.id && (
              <button type="button" className="source-link" onClick={openSource}>
                <BookOpen size={18} /><span>Тестовая инструкция</span><ArrowUpRight size={16} />
              </button>
            )}
          </div>
        ))}
        {pending && <p className="bubble assistant pending" role="status"><LoaderCircle size={17} className="spinner" /> Buddy отвечает…</p>}
        {failure && (
          <div className="bubble assistant" role="alert">
            <p>{failure}</p>
            <button type="button" className="text-link" onClick={() => void ask(messages.at(-1)!.question, true)}>Повторить <ArrowRight size={16} /></button>
          </div>
        )}
        {publication && <p className="bubble assistant">Результат сохранён в тестовом трекере. <a href={publication.url} className="text-link">Ссылка на запись <ArrowUpRight size={15} /></a></p>}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input aria-label="Спросить Buddy" placeholder="Спросить Buddy" value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" aria-label="Отправить вопрос" title="Отправить вопрос" disabled={pending || !draft.trim()}>
          <ArrowUp size={22} />
        </button>
      </form>
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
        <ol>{instruction.rules.map((rule) => <li key={rule}>{rule}</li>)}</ol>
      </div>
    </dialog>
  );
}
