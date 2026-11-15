import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Check, CircleAlert, LoaderCircle, MessageCircle } from 'lucide-react';
import type { AssignmentOffer, BuddyQuestion, DemoIdentity, Publication, RecordListItem, Run, Task, TrackerDelivery, Workspace as WorkspaceData } from '../shared/contracts';
import { responseFollowsRule, responseMatchesExpectation, sameObservedResult, standLabel, summarizeRun } from '../shared/run-summary';
import { errorMessage, post, request } from './api';
import { Evidence, RunContext, formatTime } from './Evidence';
import { NextTask, Workspace } from './Workspace';
import { Buddy, InstructionDialog, showInstruction } from './Buddy';
import { Conclusion } from './Conclusion';
import { AttemptTrail } from './AttemptTrail';
import { CopyEvidence } from './CopyEvidence';
import { TaskEditor } from './TaskEditor';

type Loaded = { workspace: WorkspaceData; publication?: Publication; records?: RecordListItem[]; revision?: Publication };

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
  const showEditor = new URLSearchParams(window.location.search).has('editor');
  const revisionId = new URLSearchParams(window.location.search).get('revise');
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
        const revision = !recordId && !records && revisionId
          ? await request<Publication>(`/api/records/${encodeURIComponent(revisionId)}`, options) : undefined;
        if (revision && (revision.review?.decision !== 'returned' || revision.nextId || workspace.task.id !== revision.run.task.id)) {
          throw new Error('Открой возвращённую версию без исправления и выбери повторную проверку.');
        }
        if (!controller.signal.aborted) setData({ workspace, publication, records, revision });
      } catch (reason) {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      }
    }
    void open();
    return () => controller.abort();
  }, [attempt, recordId, revisionId, selectedTask, showRecords]);

  return (
    <>
      <Header identity={identity} />
      {data?.publication ? <Record publication={data.publication} workspace={data.workspace} mode={mode} />
        : data?.records && showEditor && identity?.role === 'mentor' ? <TaskEditor />
        : data?.records ? <RecordList records={data.records} mentor={identity?.role === 'mentor'} offers={data.workspace.assignmentOffers} />
          : data ? <Workspace key={data.workspace.task.id} data={data.workspace} mode={mode} chooseMode={chooseMode} revision={data.revision} /> : (
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

function recordStatus(decision?: 'accepted' | 'returned' | null, delivery?: TrackerDelivery['status']) {
  if (decision) return decision === 'accepted' ? 'Принято' : 'Возвращено';
  if (delivery === 'pending') return 'Ожидает доставки';
  if (delivery === 'blocked') return 'Доставка отклонена';
  return 'На ревью';
}

function RecordList({ records, mentor, offers = [] }: { records: RecordListItem[]; mentor: boolean; offers?: AssignmentOffer[] }) {
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string>();
  const [feedback, setFeedback] = useState<{ id: string; text: string; error?: boolean }>();
  async function assign(offer: AssignmentOffer) {
    if (pending) return;
    setPending(offer.id);
    setFeedback(undefined);
    try {
      const { task } = await post<{ task: Task }>('/api/assignments', { templateId: offer.id, traineeId: offer.traineeId });
      setAssigned((versions) => ({ ...versions, [offer.id]: task.instruction.version }));
      setFeedback({ id: offer.id, text: `${offer.id} назначено стажёру А.` });
    } catch (reason) {
      setFeedback({ id: offer.id, text: errorMessage(reason), error: true });
    } finally {
      setPending(undefined);
    }
  }
  return (
    <main className="container record-page">
      {!mentor && <a href="/" className="text-link back-link"><ArrowLeft size={17} /> К рабочему пространству</a>}
      <h1>{mentor ? 'Записи на ревью' : 'Мои записи'}</h1>
      {mentor && <div className="mentor-heading-actions">
        <p>Записи назначенного тебе стажёра А.</p>
        <a href="/?editor=1" className="button primary">Создать поручение <ArrowUpRight size={17} /></a>
      </div>}
      {mentor && offers.length > 0 && <section id="assignment-offer" className="surface record-surface assignment-catalog" aria-labelledby="assignment-title">
        <h2 id="assignment-title">Поручения для стажёра А</h2>
        <ul>{offers.map((offer) => {
          const version = assigned[offer.id] ?? offer.assignedVersion;
          const titleId = `offer-${offer.id}`;
          return <li key={offer.id}>
            <div>
              <p className="fact"><span className="task-key">{offer.id}</span> · Правило v{version ?? offer.version}</p>
              <h3 id={titleId}>{offer.title}</h3>
              <p>{offer.criterion}</p>
              {feedback?.id === offer.id && feedback.error && <p role="alert" className="action-error">{feedback.text}</p>}
            </div>
            {version ? <span className="assignment-assigned"><Check size={17} /> Назначено</span>
              : <button type="button" className="button primary" aria-describedby={titleId} aria-disabled={Boolean(pending) || undefined}
                onClick={() => void assign(offer)}>{pending === offer.id ? 'Назначаем…' : 'Назначить'}</button>}
          </li>;
        })}</ul>
        <p className="visually-hidden" role="status">{feedback && !feedback.error ? feedback.text : ''}</p>
      </section>}
      <section className="surface record-surface record-list" aria-label="Опубликованные проверки">
        {records.length ? <ul>{records.map((record) => (
          <li key={record.id}>
            <a className="text-link" href={`/records/${record.id}`}>{record.taskId.startsWith('TASK-') ? record.title ?? 'Поручение наставника' : record.taskId}{record.previousId ? ' · Исправление' : ''} · {formatTime(record.publishedAt)} <ArrowUpRight size={16} /></a>
            <span>{record.nextId ? 'Есть исправленная версия' : recordStatus(record.decision, record.trackerStatus)}</span>
          </li>
        ))}</ul> : <p>Здесь появятся опубликованные проверки.</p>}
      </section>
    </main>
  );
}

function Record({ publication: initial, workspace, mode }: { publication: Publication; workspace: WorkspaceData; mode?: BuddyQuestion['mode'] }) {
  const [publication, setPublication] = useState(initial);
  const { id, run, publishedAt, conclusion, review, replay, replayBy, previous, nextId, tracker } = publication;
  const instruction = useRef<HTMLDialogElement>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState('');
  const [sending, setSending] = useState(false);
  const [deliveryError, setDeliveryError] = useState('');
  const [fixed, setFixed] = useState(Boolean(workspace.standFixed));
  const [switchingStand, setSwitchingStand] = useState(false);
  const [checkingReplay, setCheckingReplay] = useState(false);
  const [replayConclusion, setReplayConclusion] = useState(conclusion ?? '');
  const [editing, setEditing] = useState(false);
  const [useReplay, setUseReplay] = useState(false);
  const [revisedConclusion, setRevisedConclusion] = useState(conclusion ?? '');
  const mentor = workspace.identity?.role === 'mentor';
  const task = run.task;
  const nextAssignment = workspace.tasks.find((candidate) => candidate.comparison && candidate.id !== task.id);
  const buddyContext = { task, kind: run.kind, buddyMode: workspace.buddyMode, buddyProvider: workspace.buddyProvider };
  const evidenceRun = useReplay && replay ? replay : run;
  const canRevise = !mentor && review?.decision === 'returned' && !nextId;

  function openOriginal() {
    const source = document.getElementById(`result-evidence-${run.checks[0].id}`);
    source?.querySelectorAll('details').forEach((detail) => { detail.open = true; });
    source?.querySelector('summary')?.focus({ preventScroll: true });
    source?.scrollIntoView({ block: 'start' });
  }

  async function decide(decision: 'accepted' | 'returned') {
    setBusy(true);
    setError('');
    try {
      const updated = await post<Publication>(`/api/records/${id}/review`, { decision, comment });
      setPublication((previous) => ({ ...previous, ...updated }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function retryDelivery() {
    setSending(true);
    setDeliveryError('');
    try {
      const updated = await post<TrackerDelivery>(`/api/records/${id}/tracker`);
      setPublication((previous) => ({ ...previous, tracker: updated }));
    } catch (reason) {
      setDeliveryError(errorMessage(reason));
    } finally {
      setSending(false);
    }
  }
  async function repeat() {
    setReplaying(true);
    setReplayError('');
    try {
      const result = await post<Run>(`/api/records/${id}/replay`);
      setPublication((previous) => ({ ...previous, replay: result, replayBy: workspace.identity?.id }));
      setCheckingReplay(false);
      setReplayConclusion(conclusion ?? '');
      setUseReplay(false);
    } catch (reason) {
      setReplayError(errorMessage(reason));
    } finally {
      setReplaying(false);
    }
  }
  async function changeStand() {
    setSwitchingStand(true);
    setReplayError('');
    try {
      const state = await post<{ fixed: boolean }>('/api/demo/stand', { fixed: !fixed });
      setFixed(state.fixed);
    } catch (reason) {
      setReplayError(errorMessage(reason));
    } finally {
      setSwitchingStand(false);
    }
  }
  async function submitRevision() {
    setBusy(true);
    setError('');
    try {
      const result = await post<Publication>(`/api/records/${id}/revisions`, { conclusion: revisedConclusion, runId: evidenceRun.id });
      window.location.assign(result.url);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  }
  return (
    <main className="container record-page">
      <a href={mentor ? '/?records=1' : run.task.id === 'SEARCH-01' && !workspace.tasks.some(({ authoringId }) => authoringId) ? '/' : `/?task=${encodeURIComponent(run.task.id)}`} className="text-link back-link"><ArrowLeft size={17} /> {mentor ? 'К записям на ревью' : 'К рабочему пространству'}</a>
      <div className="record-hero">
        <span className="task-key">{task.authoringId ? `Поручение · v${task.instruction.version}` : task.id}</span>
        <h1>Запись проверки</h1>
        <p>{run.task.title}</p>
      </div>
      {!mentor && mode !== 'manual' && <a href="#buddy-title" className="text-link record-discuss"><MessageCircle size={17} /> Обсудить запись с Buddy</a>}
      <div className="workspace-grid">
        <section className="surface record-surface">
          <div className="record-banner">
            <span className="signal ok"><Check size={17} /></span>
            <div><strong>Запись сохранена</strong><code>{id}</code></div>
            <time dateTime={publishedAt}>{formatTime(publishedAt)}</time>
          </div>
          <section className="record-summary" aria-label="Передача результата">
            <p className="record-conclusion"><strong>Вывод стажёра</strong>{conclusion || 'Вывод не добавлен.'}</p>
            <p className="record-status" role="status">{recordStatus(review?.decision, tracker?.status)}</p>
          {tracker && <div className="tracker-delivery">
            <div role="status">
              {tracker.status === 'delivered' && <><strong>Доставлено в демо-трекер</strong><code>{tracker.id}</code></>}
              {tracker.status === 'pending' && <p className="fact">{sending ? 'Отправляем в демо-трекер…' : 'Трекер ещё не подтвердил получение. Снимок и вывод сохранены.'}</p>}
              {tracker.status === 'blocked' && <><strong>Трекер отклонил отправку</strong><p className="fact">Запись доступна для ревью. Сообщи об отказе ответственному за трекер.</p></>}
            </div>
            {tracker.status === 'pending' && !mentor && <button type="button" className="button primary" disabled={sending} onClick={() => void retryDelivery()}>
              Повторить отправку
            </button>}
            {deliveryError && <p className="action-error" role="alert">{deliveryError}</p>}
          </div>}
            {mentor && <div className="record-source-actions">
              <button type="button" className="text-link" onClick={() => showInstruction(instruction.current)}>Открыть правило</button>
              <button type="button" className="text-link" onClick={openOriginal}>Открыть исходный ответ</button>
            </div>}
          </section>
          <section className="record-summary" aria-label="Резюме проверки">
            <h2>Что проверили</h2>
            <p>{task.description}</p>
            <p className="fact">Правило v{task.instruction.version}</p>
            {run.preparation && <p className="record-conclusion"><strong>Вопрос стажёра</strong>{run.preparation.question}</p>}
            <p>Источник ожидания · {run.preparation ? 'на основе черновика Buddy' : 'ручной ввод'} по инструкции команды.</p>
            {summarizeRun(run).map((fact) => <p className="fact" key={fact}>{fact}</p>)}
            {previous && <section className="revision-context" aria-label="Предыдущая версия">
              <a href={`/records/${previous.id}`} className="text-link">Предыдущая версия <ArrowUpRight size={15} /></a>
              <p>{previous.runId === run.id ? 'Исправлен вывод. Использован исходный прогон.' : 'Исправление опирается на другой сохранённый прогон.'}</p>
              {previous.conclusion && <p className="record-conclusion"><strong>Предыдущий вывод</strong>{previous.conclusion}</p>}
              {previous.review?.comment && <p className="record-conclusion"><strong>Замечание наставника</strong>{previous.review.comment}</p>}
            </section>}
            {nextId && <a href={`/records/${nextId}`} className="text-link">Открыть исправленную версию <ArrowUpRight size={15} /></a>}
            <CopyEvidence publication={publication} />
          </section>
          <AttemptTrail run={run} openRule={(n) => showInstruction(instruction.current, n)} />
          <section className="record-summary" aria-label="Повтор проверки">
            {mentor ? <details className="response-details stand-switch">
              <summary>Демо-стенд · {fixed ? 'исправный ответ' : 'ответ с дефектом'}</summary>
              <p>Настройка действует на тестовые поручения в этом запуске.</p>
              <button type="button" className="button secondary" disabled={switchingStand || replaying} onClick={() => void changeStand()}>
                {fixed ? 'Вернуть дефект на стенд' : 'Включить исправный ответ'}
              </button>
            </details> : workspace.identity && <p className="fact">Демо-стенд сейчас · {fixed ? 'исправный ответ' : 'ответ с дефектом'}</p>}
            <button type="button" className="button secondary" disabled={replaying || switchingStand || busy || editing} onClick={() => void repeat()}>
              {replaying ? 'Повторяем запрос…' : 'Повторить проверку'}
            </button>
            {replayError && <p role="alert" className="action-error">{replayError}</p>}
            {replay && <>
              <p className="replay-state" role="status">
                <strong>{sameObservedResult(run, replay) ? 'Результат повтора совпал с исходным' : 'Результат повтора изменился'}</strong>
                {replayBy && <> · {replayBy === 'demo-mentor' ? 'Наставник' : replayBy === 'demo-trainee-b' ? 'Стажёр Б' : 'Стажёр А'}</>}
              </p>
              <div id="record-replay" className="replay-summary">
              {[{ title: 'Исходный прогон', run }, { title: 'Последний повтор', run: replay }].map(({ title, run }) => (
                <div key={run.id}><h3>{title}</h3><time dateTime={run.checkedAt}>{formatTime(run.checkedAt)}</time>
                  <p className="fact">{standLabel(run)} · <code>{run.id.slice(0, 8)}</code></p>
                  {summarizeRun(run).map((fact) => <p className="fact" key={fact}>{fact}</p>)}
                  <p className="fact"><strong>Совпадение с ожиданием</strong> · {run.checks.every(responseMatchesExpectation) ? 'да' : 'есть расхождение'}</p>
                  <p className="fact"><strong>Соответствие правилу</strong> · {run.checks.every(responseFollowsRule) ? 'да' : 'есть расхождение'}</p>
                </div>
              ))}
              </div>
              <details className="response-details">
                <summary>Открыть ответ повтора</summary>
                <Evidence run={replay} anchorPrefix="record-replay" />
              </details>
              {!mentor && mode !== 'manual' && !checkingReplay && !editing && <button type="button" className="button secondary"
                onClick={() => setCheckingReplay(true)}>Сверить старый вывод с повтором</button>}
              {checkingReplay && <Conclusion key={replay.id} run={replay} value={replayConclusion} onChange={setReplayConclusion}
                label="Вывод для проверки по повтору" context="последний повтор" mode={mode} openRule={(n) => showInstruction(instruction.current, n)} evidenceAnchor="record-replay" />}
              {checkingReplay && canRevise && !editing && <button type="button" className="button secondary" onClick={() => {
                setRevisedConclusion(replayConclusion);
                setUseReplay(true);
                setEditing(true);
                setCheckingReplay(false);
                document.getElementById('review-title')?.focus();
              }}>Исправить запись по повтору</button>}
            </>}
          </section>
          <RunContext run={run} showRules />
          <Evidence run={run} anchorPrefix="result-evidence" />
          {!mentor && task.id === 'SEARCH-01' && <NextTask />}
          {!mentor && task.id !== 'SEARCH-01' && nextAssignment &&
            <a className="text-link" href={`/?task=${encodeURIComponent(nextAssignment.id)}`}>
              Открыть поручение · {nextAssignment.shortTitle ?? nextAssignment.title} <ArrowUpRight size={15} />
            </a>}
        </section>
        <div className="record-sidebar">
          <section className="surface review-panel" aria-labelledby="review-title">
            <h2 id="review-title" tabIndex={-1}>Решение наставника</h2>
            {mentor && workspace.assignmentOffers?.some((offer) => !offer.assignedVersion) &&
              <a className="text-link" href="/?records=1#assignment-offer">Назначить следующее поручение <ArrowUpRight size={15} /></a>}
            {review ? <div role="status">
              <p><strong>{reviewLabel[review.decision]}</strong> · <time dateTime={review.reviewedAt}>{formatTime(review.reviewedAt)}</time></p>
              {review.comment && <p className="record-conclusion">{review.comment}</p>}
              {!mentor && <p>{review.decision === 'accepted' ? 'Запись готова для работы команды.' : 'Учти комментарий в исправленной версии.'}</p>}
            </div> : mentor ? <>
              <p>Прими запись, если по ней можно воспроизвести проверку или разобраться в описанном дефекте.</p>
              <label htmlFor="mentor-comment">Комментарий наставника</label>
              <textarea id="mentor-comment" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={3} />
              <button type="button" className="button primary" disabled={busy} onClick={() => void decide('accepted')}>Принять результат</button>
              <button type="button" className="button secondary" disabled={busy || !comment.trim()} onClick={() => void decide('returned')}>Вернуть с комментарием</button>
              {busy && <p role="status">Сохраняем решение…</p>}
              {error && <p className="action-error" role="alert">{error}</p>}
            </> : <p role="status">Ожидает решения. Наставник увидит опубликованную запись в своём списке.</p>}
            {canRevise && <>
              {!editing ? <button type="button" className="button primary" onClick={() => {
                setEditing(true);
                setCheckingReplay(false);
              }}>Исправить вывод</button> : <>
                {replay && <label>Прогон для исправления <select value={useReplay ? 'replay' : 'original'} disabled={busy}
                  onChange={(event) => setUseReplay(event.target.value === 'replay')}>
                  <option value="original">Исходный прогон</option>
                  <option value="replay">Последний повтор</option>
                </select></label>}
                <Conclusion key={evidenceRun.id} run={evidenceRun} value={revisedConclusion} onChange={setRevisedConclusion} mode={mode}
                  context={useReplay ? 'последний повтор' : 'исходный прогон'} evidenceAnchor={useReplay ? 'record-replay' : 'result-evidence'}
                  label="Исправленный вывод" openRule={(n) => showInstruction(instruction.current, n)} />
                <button type="button" className="button primary"
                  disabled={busy || !revisedConclusion.trim() || (!useReplay && revisedConclusion.trim() === conclusion)}
                  onClick={() => void submitRevision()}>{busy ? 'Отправляем…' : 'Отправить исправление'}</button>
                {error && <p className="action-error" role="alert">{error}</p>}
                <button type="button" className="text-link" disabled={busy} onClick={() => { setEditing(false); setUseReplay(false); }}>Закрыть исправление</button>
              </>}
              <a className="text-link" href={`/?task=${encodeURIComponent(run.task.id)}&revise=${encodeURIComponent(id)}`}>
                Изменить ожидание и запустить заново <ArrowUpRight size={15} />
              </a>
            </>}
          </section>
          {!mentor && <Buddy workspace={buddyContext} run={run} mode={mode} openSource={(ruleNumber) => showInstruction(instruction.current, ruleNumber)} />}
        </div>
      </div>
      <InstructionDialog instruction={task.instruction} dialog={instruction} />
    </main>
  );
}
