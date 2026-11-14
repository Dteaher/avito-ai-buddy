import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Check, CircleAlert, LoaderCircle, MessageCircle } from 'lucide-react';
import type { BuddyQuestion, DemoIdentity, Publication, RecordListItem, Run, Workspace as WorkspaceData } from '../shared/contracts';
import { summarizeRun } from '../shared/run-summary';
import { errorMessage, post, request } from './api';
import { Evidence, RunContext, formatTime } from './Evidence';
import { NextTask, Workspace } from './Workspace';
import { Buddy, InstructionDialog, showInstruction } from './Buddy';

type Loaded = { workspace: WorkspaceData; publication?: Publication; records?: RecordListItem[] };

function Header({ identity }: { identity?: DemoIdentity }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(value: string) {
    setBusy(true);
    setError('');
    try {
      await post('/api/session', { identity: value });
      window.location.reload();
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  }
  return (
    <header className="site-header">
      <div className="container masthead">
        <a href="/" className="brand" aria-label="AI-buddy, рабочее пространство">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          AI-buddy
        </a>
        {identity ? <label className="identity-picker">Демо-вход
          <select value={identity.id} disabled={busy} onChange={(event) => void change(event.target.value)}>
            <option value="demo-trainee">Стажёр А</option>
            <option value="demo-trainee-b">Стажёр Б</option>
            <option value="demo-mentor">Наставник</option>
          </select>
        </label> : <span className="environment"><i />Тестовый стенд</span>}
      </div>
      {error && <p className="container action-error" role="alert">{error}</p>}
    </header>
  );
}

export function App() {
  const recordId = /^\/records\/([^/]+)\/?$/.exec(window.location.pathname)?.[1];
  const selectedTask = new URLSearchParams(window.location.search).get('task');
  const showRecords = new URLSearchParams(window.location.search).has('records');
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [identity, setIdentity] = useState<DemoIdentity>();
  const [mode, setMode] = useState<BuddyQuestion['mode']>(() => {
    const value = sessionStorage.getItem('buddy-mode');
    return value === 'manual' || value === 'guide' ? value : undefined;
  });

  function chooseMode(value: BuddyQuestion['mode']) {
    if (value) sessionStorage.setItem('buddy-mode', value);
    else sessionStorage.removeItem('buddy-mode');
    setMode(value);
  }

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    async function open() {
      try {
        const workspacePath = !recordId && selectedTask ? `/api/workspace?task=${encodeURIComponent(selectedTask)}` : '/api/workspace';
        const workspace = await request<WorkspaceData>(workspacePath, options);
        if (!controller.signal.aborted) setIdentity(workspace.identity);
        const publication = recordId ? await request<Publication>(`/api/records/${recordId}`, options) : undefined;
        const records = !recordId && (showRecords || workspace.identity?.role === 'mentor')
          ? await request<RecordListItem[]>('/api/records', options) : undefined;
        if (!controller.signal.aborted) setData({ workspace, publication, records });
      } catch (reason) {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      }
    }
    void open();
    return () => controller.abort();
  }, [attempt, recordId, selectedTask, showRecords]);

  return (
    <>
      <Header identity={identity} />
      {data?.publication ? <Record publication={data.publication} workspace={data.workspace} mode={mode} />
        : data?.records ? <RecordList records={data.records} mentor={identity?.role === 'mentor'} />
          : data ? <Workspace key={data.workspace.task.id} data={data.workspace} mode={mode} chooseMode={chooseMode} /> : (
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

const reviewLabel = { accepted: 'Результат принят', returned: 'Возвращено с комментарием' };

function RecordList({ records, mentor }: { records: RecordListItem[]; mentor: boolean }) {
  return (
    <main className="container record-page">
      {!mentor && <a href="/" className="text-link back-link"><ArrowLeft size={17} /> К рабочему пространству</a>}
      <h1>{mentor ? 'Записи на ревью' : 'Мои записи'}</h1>
      {mentor && <p>Записи назначенного тебе стажёра А.</p>}
      <section className="surface record-surface record-list" aria-label="Опубликованные проверки">
        {records.length ? <ul>{records.map((record) => (
          <li key={record.id}>
            <a className="text-link" href={`/records/${record.id}`}>{record.taskId} · {formatTime(record.publishedAt)} <ArrowUpRight size={16} /></a>
            <span>{record.decision ? reviewLabel[record.decision] : 'Ожидает решения'}</span>
          </li>
        ))}</ul> : <p>Здесь появятся опубликованные проверки.</p>}
      </section>
    </main>
  );
}

function Record({ publication: initial, workspace, mode }: { publication: Publication; workspace: WorkspaceData; mode?: BuddyQuestion['mode'] }) {
  const [publication, setPublication] = useState(initial);
  const { id, run, publishedAt, conclusion, review, replay } = publication;
  const instruction = useRef<HTMLDialogElement>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState('');
  const mentor = workspace.identity?.role === 'mentor';
  const task = run.task;
  const buddyContext = { task, kind: run.kind, buddyMode: workspace.buddyMode, buddyProvider: workspace.buddyProvider };

  async function decide(decision: 'accepted' | 'returned') {
    setBusy(true);
    setError('');
    try {
      const updated = await post<Publication>(`/api/records/${id}/review`, { decision, comment });
      setPublication(updated);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function repeat() {
    setReplaying(true);
    setReplayError('');
    try {
      const result = await post<Run>(`/api/records/${id}/replay`);
      setPublication((previous) => ({ ...previous, replay: result }));
    } catch (reason) {
      setReplayError(errorMessage(reason));
    } finally {
      setReplaying(false);
    }
  }
  return (
    <main className="container record-page">
      <a href={mentor ? '/?records=1' : run.kind === 'price-order' ? '/?task=SORT-01' : '/'} className="text-link back-link"><ArrowLeft size={17} /> {mentor ? 'К записям на ревью' : 'К рабочему пространству'}</a>
      <div className="record-hero">
        <span className="task-key">{run.task.id}</span>
        <h1>Запись проверки</h1>
        <p>{run.task.title}</p>
      </div>
      {!mentor && mode !== 'manual' && <a href="#buddy-title" className="text-link record-discuss"><MessageCircle size={17} /> Обсудить запись с Buddy</a>}
      <div className="workspace-grid">
        <section className="surface record-surface">
          <div className="record-banner">
            <span className="signal ok"><Check size={17} /></span>
            <div><strong>Опубликовано в тестовом трекере</strong><code>{id}</code></div>
            <time dateTime={publishedAt}>{formatTime(publishedAt)}</time>
          </div>
          <section className="record-summary" aria-label="Резюме проверки">
            <h2>Что проверили</h2>
            <p>{task.description}</p>
            {run.preparation && <p className="record-conclusion"><strong>Вопрос стажёра</strong>{run.preparation.question}</p>}
            <p>Источник ожидания · {run.preparation ? 'на основе черновика Buddy' : 'ручной ввод'} по инструкции команды.</p>
            {summarizeRun(run).map((fact) => <p className="fact" key={fact}>{fact}</p>)}
            <p className="record-conclusion"><strong>Вывод стажёра</strong>{conclusion || 'Вывод не добавлен.'}</p>
          </section>
          {!mentor && <section className="record-summary" aria-label="Повтор проверки">
            <button type="button" className="button secondary" disabled={replaying} onClick={() => void repeat()}>
              {replaying ? 'Повторяем запрос…' : 'Повторить проверку'}
            </button>
            {replayError && <p role="alert" className="action-error">{replayError}</p>}
            {replay && <div className="replay-summary" aria-live="polite">
              {[{ title: 'Исходный прогон', run }, { title: 'Последний повтор', run: replay }].map(({ title, run }) => (
                <div key={run.id}><h3>{title}</h3><time dateTime={run.checkedAt}>{formatTime(run.checkedAt)}</time>
                  {summarizeRun(run).map((fact) => <p className="fact" key={fact}>{fact}</p>)}
                </div>
              ))}
            </div>}
          </section>}
          <RunContext run={run} showRules />
          <Evidence run={run} />
          {!mentor && run.kind !== 'price-order' && <NextTask />}
        </section>
        <div className="record-sidebar">
          <section className="surface review-panel" aria-labelledby="review-title">
            <h2 id="review-title">Решение наставника</h2>
            {review ? <div role="status">
              <p><strong>{reviewLabel[review.decision]}</strong> · <time dateTime={review.reviewedAt}>{formatTime(review.reviewedAt)}</time></p>
              {review.comment && <p className="record-conclusion">{review.comment}</p>}
              {!mentor && <p>{review.decision === 'accepted' ? 'Запись готова для работы команды. Можно перейти к следующей задаче.' : 'Учти комментарий и передай наставнику новую запись с уточнённой проверкой.'}</p>}
            </div> : mentor ? <>
              <p>Прими запись, если по ней можно воспроизвести проверку или разобраться в описанном дефекте.</p>
              <label htmlFor="mentor-comment">Комментарий наставника</label>
              <textarea id="mentor-comment" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={3} />
              <button type="button" className="button primary" disabled={busy} onClick={() => void decide('accepted')}>Принять результат</button>
              <button type="button" className="button secondary" disabled={busy || !comment.trim()} onClick={() => void decide('returned')}>Вернуть с комментарием</button>
              {busy && <p role="status">Сохраняем решение…</p>}
              {error && <p className="action-error" role="alert">{error}</p>}
            </> : <p role="status">Ожидает решения. Наставник увидит опубликованную запись в своём списке.</p>}
          </section>
          {!mentor && <Buddy workspace={buddyContext} run={run} mode={mode} openSource={(ruleNumber) => showInstruction(instruction.current, ruleNumber)} />}
        </div>
      </div>
      <InstructionDialog instruction={task.instruction} dialog={instruction} />
    </main>
  );
}
