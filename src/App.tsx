import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Check, CircleAlert, LoaderCircle, MessageCircle } from 'lucide-react';
import type { Publication, Workspace as WorkspaceData } from '../shared/contracts';
import { errorMessage, request } from './api';
import { Evidence, RunContext, formatTime } from './Evidence';
import { NextTask, Workspace } from './Workspace';
import { Buddy, InstructionDialog, showInstruction } from './Buddy';

type Loaded = { workspace: WorkspaceData; publication?: Publication };

function Header() {
  return (
    <header className="site-header">
      <div className="container masthead">
        <a href="/" className="brand" aria-label="AI-buddy, рабочее пространство">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          AI-buddy
        </a>
        <div className="masthead-meta">
          <span className="environment"><i />Тестовый стенд</span>
          <span className="avatar" aria-label="Демо-стажёр" title="Демо-стажёр">ДС</span>
        </div>
      </div>
    </header>
  );
}

export function App() {
  const recordId = /^\/records\/([^/]+)\/?$/.exec(window.location.pathname)?.[1];
  const selectedTask = new URLSearchParams(window.location.search).get('task');
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    async function open() {
      try {
        const workspacePath = !recordId && selectedTask ? `/api/workspace?task=${encodeURIComponent(selectedTask)}` : '/api/workspace';
        const workspace = await request<WorkspaceData>(workspacePath, options);
        const publication = recordId ? await request<Publication>(`/api/records/${recordId}`, options) : undefined;
        if (!controller.signal.aborted) setData({ workspace, publication });
      } catch (reason) {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      }
    }
    void open();
    return () => controller.abort();
  }, [attempt, recordId, selectedTask]);

  return (
    <>
      <Header />
      {data?.publication ? <Record publication={data.publication} workspace={data.workspace} /> : data ? <Workspace data={data.workspace} /> : (
        <main className="container initial">
          {error ? (
            <section className="surface startup" role="alert">
              <CircleAlert aria-hidden="true" /><h1>Не удалось открыть страницу</h1><p>{error}</p>
              <button className="button primary" onClick={() => { setError(''); setAttempt(attempt + 1); }}>Повторить</button>
              {recordId && <a className="text-link" href="/">К рабочему пространству <ArrowUpRight size={16} /></a>}
            </section>
          ) : <p className="loading" role="status"><LoaderCircle size={20} className="spinner" /> Загружаем {recordId ? 'запись' : 'задачу'}…</p>}
        </main>
      )}
      <footer className="container footer"><span>AI-buddy · Первая проверка</span><span>Синтетические данные <ArrowDownRight size={14} aria-hidden="true" /></span></footer>
    </>
  );
}

function Record({ publication, workspace }: { publication: Publication; workspace: WorkspaceData }) {
  const { id, run, publishedAt } = publication;
  const instruction = useRef<HTMLDialogElement>(null);
  const task = run.task;
  const buddyContext = { task, kind: run.kind, buddyMode: workspace.buddyMode, buddyProvider: workspace.buddyProvider };
  return (
    <main className="container record-page">
      <a href={run.kind === 'price-order' ? `/?task=${encodeURIComponent(run.task.id)}` : '/'} className="text-link back-link"><ArrowLeft size={17} /> К рабочему пространству</a>
      <div className="record-hero">
        <span className="task-key">{run.task.id}</span>
        <h1>Запись проверки</h1>
        <p>{run.task.title}</p>
      </div>
      <a href="#buddy-title" className="text-link record-discuss"><MessageCircle size={17} /> Обсудить запись с Buddy</a>
      <div className="workspace-grid">
        <section className="surface record-surface">
          <div className="record-banner">
            <span className="signal ok"><Check size={17} /></span>
            <div><strong>Опубликовано в тестовом трекере</strong><code>{id}</code></div>
            <time dateTime={publishedAt}>{formatTime(publishedAt)}</time>
          </div>
          <RunContext run={run} showRules />
          <Evidence run={run} />
          {run.kind !== 'price-order' && <NextTask />}
        </section>
        <Buddy workspace={buddyContext} run={run} openSource={(ruleNumber) => showInstruction(instruction.current, ruleNumber)} />
      </div>
      <InstructionDialog instruction={task.instruction} dialog={instruction} />
    </main>
  );
}
