import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus } from 'lucide-react';
import { groupLabels, taskClarificationSections, type CheckId, type DemoIdentity, type TaskClarification, type TaskDraft, type TaskDraftInput,
  type TaskEditorData, type TaskProject, type TaskVersion } from '../shared/contracts';
import { errorMessage, post, request } from './api';
import { TaskClarityReport } from './TaskClarityReport';
import { TaskSuggestion } from './TaskSuggestion';
import { taskInsights } from '../shared/task-insights';

const endpoint = '/api/mentor/tasks';
const blank: TaskDraftInput = { title: '', description: '', criterion: '', checkIds: [] };
const editorFields = { description: 'editor-description', criterion: 'editor-criterion', checks: 'editor-checks' };
const refreshedNotice = 'Сводка обновлена.';

function revealField(section: TaskClarification['section']) {
  const field = document.getElementById(editorFields[section]);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  field?.scrollIntoView?.({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
  field?.focus({ preventScroll: true });
}

export function TaskEditor({ initialProject = null, initialVersion = null }: { initialProject?: string | null; initialVersion?: string | null }) {
  const [data, setData] = useState<TaskEditorData>();
  const [projectId, setProjectId] = useState<string>();
  const [input, setInput] = useState<TaskDraftInput | undefined>(blank);
  const [basis, setBasis] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editContext, setEditContext] = useState<{ section: TaskClarification['section']; version: TaskVersion }>();
  const project = data?.projects.find(({ id }) => id === projectId);
  const latest = project?.versions[0];
  const saved = project?.draft;
  const preview = input ?? latest?.input;
  const suggestionInsight = editContext && input ? taskInsights(editContext.version.task, editContext.version.participants)
    .find(({ section, checkId }) => section === editContext.section && input.checkIds.includes(checkId))?.text : undefined;
  const valid = input && Boolean(input.title.trim() && input.description.trim() && input.criterion.trim() && input.checkIds.length);
  const started = input && Boolean(input.title.trim() || input.description.trim() || input.criterion.trim() || input.checkIds.length);
  const savedInput = saved?.revision === basis && saved && JSON.stringify(input) === JSON.stringify(saved.input);

  useEffect(() => {
    const controller = new AbortController();
    void request<TaskEditorData>(endpoint, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setData(result);
      const selected = result.projects.find(({ id }) => id === initialProject);
      if (selected) {
        setProjectId(selected.id);
        setInput(selected.draft?.input);
        setBasis(selected.draft?.revision);
      }
    }, (reason: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    });
    return () => controller.abort();
  }, [initialProject]);

  useEffect(() => {
    if (editContext) revealField(editContext.section);
  }, [editContext]);

  function openProject(next?: TaskProject) {
    setProjectId(next?.id);
    setInput(next ? next.draft?.input : blank);
    setBasis(next?.draft?.revision);
    setError('');
    setNotice('');
    setEditContext(undefined);
  }

  function editLatest() {
    if (!latest) return;
    setInput(latest.input);
    setBasis(String(latest.version));
  }

  function clarify(version: TaskVersion, section: TaskClarification['section']) {
    if (!input) editLatest();
    setEditContext({ section, version });
  }

  async function change(operation?: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    if (!operation) setRefreshing(true);
    setNotice('');
    setError('');
    try {
      const message = operation ? await operation() : refreshedNotice;
      setData(await request<TaskEditorData>(endpoint));
      setNotice(message);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
      setRefreshing(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!input || (!started && !saved)) return;
    void change(async () => {
      if (project) {
        const updated = await post<TaskDraft>(`${endpoint}/${project.id}/draft`, { ...input, basedOn: basis });
        setInput(updated.input);
        setBasis(updated.revision);
      } else {
        const created = await post<TaskProject>(endpoint, input);
        setProjectId(created.id);
        setInput(created.draft?.input);
        setBasis(created.draft?.revision);
      }
      return 'Черновик сохранён.';
    });
  }

  function publish() {
    if (!project || !saved || !savedInput || !valid) return;
    void change(async () => {
      await post(`${endpoint}/${project.id}/publish`, { revision: saved.revision });
      setInput(undefined);
      setBasis(undefined);
      setEditContext(undefined);
      return 'Версия опубликована. Выбери её для назначения.';
    });
  }

  function assign(version: TaskVersion, trainee: DemoIdentity) {
    void change(async () => {
      await post('/api/assignments', { versionId: version.task.id, traineeId: trainee.id });
      return `Версия ${version.task.instruction.version} назначена. Получатель — ${trainee.name}.`;
    });
  }

  function toggle(id: CheckId) {
    setInput((current) => current && ({
      ...current,
      checkIds: current.checkIds.includes(id) ? current.checkIds.filter((value) => value !== id) : [...current.checkIds, id],
    }));
  }

  return (
    <main className="container record-page task-editor">
      <a className="text-link back-link" href="/?records=1"><ArrowLeft size={17} /> К записям на ревью</a>
      <div className="editor-heading">
        <div><h1>{project ? 'Редактор поручения' : 'Создать поручение'}</h1><p>Сформулируй цель и выбери, что стенд проверит автоматически.</p></div>
        {project && <button className="button secondary" type="button" disabled={busy} onClick={() => openProject()}><Plus size={17} /> Новое поручение</button>}
      </div>
      {data?.projects.length ? <label className="editor-projects">Сохранённые поручения
        <select value={projectId ?? ''} disabled={busy} onChange={(event) => openProject(data.projects.find(({ id }) => id === event.target.value))}>
          <option value="">Новое поручение</option>
          {data.projects.map(({ id, draft, versions }) => <option key={id} value={id}>
            {draft?.input.title ?? versions[0]?.task.title} {draft ? '· черновик' : `· v${versions[0]?.task.instruction.version}`}
            {versions.some(({ participants }) => participants.some(({ clarification }) => clarification)) ? ' · есть вопросы' : ''}
          </option>)}
        </select>
      </label> : null}
      {error && <p className="action-error" role="alert">{error}</p>}
      {notice && <p className={notice === refreshedNotice ? 'visually-hidden' : 'editor-notice'} role="status">
        <Check size={17} aria-hidden="true" /> {notice}
      </p>}
      {!data && !error && <p role="status">Загружаем каталог проверок…</p>}
      {data && project && project.versions.length > 0 && <TaskClarityReport key={project.id}
        versions={project.versions} trainees={data.trainees} initialVersion={initialProject === project.id ? initialVersion : null}
        busy={busy} refreshing={refreshing} onClarify={clarify} onRefresh={() => void change()} />}
      {data && <div className="editor-grid">
        {input ? <form className="surface record-surface editor-form" onSubmit={save}>
          <h2>{project ? 'Черновик поручения' : 'Новое поручение'}</h2>
          {editContext && <div className="clarification-note">
            <strong id="editor-clarification">{taskClarificationSections[editContext.section]} · вопросы по версии {editContext.version.task.instruction.version}</strong>
            <ul>{editContext.version.participants.map(({ traineeId, clarification }) => clarification?.section === editContext.section
              ? <li key={traineeId}>{clarification.text}</li> : null)}</ul>
          </div>}
          <div className="editor-field"><label htmlFor="editor-title">Название</label>
            <input id="editor-title" maxLength={80} value={input.title} disabled={busy}
              onChange={(event) => setInput({ ...input, title: event.target.value })} />
          </div>
          <div className="editor-field"><label htmlFor="editor-description">Описание</label>
            <textarea id="editor-description" aria-describedby={editContext?.section === 'description' ? 'editor-clarification' : undefined}
              rows={3} maxLength={600} value={input.description} disabled={busy}
              onChange={(event) => setInput({ ...input, description: event.target.value })} />
          </div>
          <div className="editor-field"><label htmlFor="editor-criterion">Критерий успеха</label>
            <textarea id="editor-criterion" aria-describedby={editContext?.section === 'criterion' ? 'editor-clarification' : undefined}
              rows={2} maxLength={240} value={input.criterion} disabled={busy}
              onChange={(event) => setInput({ ...input, criterion: event.target.value })} />
          </div>
          {data.canSuggest && project && editContext && editContext.section !== 'checks' && <TaskSuggestion
            key={`${editContext.version.task.id}/${editContext.section}`} projectId={project.id} versionId={editContext.version.task.id}
            section={editContext.section} input={input} disabled={busy} observation={suggestionInsight}
            onApply={(text) => {
              setInput({ ...input, [editContext.section]: text });
              revealField(editContext.section);
            }} />}
          <fieldset id="editor-checks" tabIndex={-1} disabled={busy}
            aria-describedby={editContext?.section === 'checks' ? 'editor-clarification' : undefined}>
            <legend>Разрешённые проверки</legend>
            {data.catalog.map((check) => <label className="editor-check" key={check.id}>
              <input type="checkbox" checked={input.checkIds.includes(check.id)} onChange={() => toggle(check.id)} />
              <span><strong>{check.label}</strong><code>GET {check.path}</code>
                <small>{check.required.map((value) => groupLabels[value]).join(', ')}{check.uniqueIds ? ' · уникальные ID' : ''}</small></span>
            </label>)}
          </fieldset>
          <div className="editor-actions">
            {savedInput && !valid && <p className="fact">Заполни все поля и выбери проверку для публикации.</p>}
            {savedInput && valid ? <button type="button" className="button primary" disabled={busy} onClick={publish}>Опубликовать версию <ArrowRight size={17} /></button>
              : <button type="submit" className="button primary" disabled={busy || (!started && !saved) || Boolean(savedInput)}>Сохранить черновик <ArrowRight size={17} /></button>}
          </div>
        </form> : <section className="surface record-surface editor-form">
          <h2>{latest?.task.title}</h2>
          <p>Опубликована версия {latest?.task.instruction.version}. Для изменений создай новый черновик.</p>
          <div><button type="button" className="button secondary" disabled={busy} onClick={editLatest}>Править в новом черновике</button></div>
        </section>}
        <section className="surface record-surface editor-preview" aria-label="Предпросмотр стажёра">
          <h2>Предпросмотр стажёра</h2>
          <h3>{preview?.title.trim() || 'Название поручения'}</h3>
          {preview?.description.trim() && <p>{preview.description}</p>}
          {preview?.criterion.trim() && <p><strong>Критерий успеха</strong><br />{preview.criterion}</p>}
          {preview?.checkIds.length ? <div className="editor-preview-rules">
            <strong>Что проверит сервер</strong>
            <ol>{preview.checkIds.map((id) => {
              const check = data.catalog.find((candidate) => candidate.id === id);
              return check && <li key={id}>{check.label}<br />
                {check.required.map((value) => groupLabels[value]).join(', ')}{check.uniqueIds ? ' · ID товаров уникальны' : ''}</li>;
            })}</ol>
          </div> : <p className="fact">Выбери проверку, чтобы увидеть машинное условие.</p>}
          <span className="button secondary editor-preview-button" aria-hidden="true">Начать проверку <ArrowRight size={17} /></span>
        </section>
      </div>}
      {project?.versions.length ? <section className="surface record-surface editor-versions" aria-label="Опубликованные версии">
        <h2>Опубликованные версии</h2>
        <ul>{project.versions.map((version) => {
          const { participants, task } = version;
          return <li key={task.id}>
            <div><strong>v{task.instruction.version} · {task.title}</strong><p>{task.criterion}</p>
            </div>
            <div className="version-recipients">
              {data?.trainees.map((trainee) => participants.some(({ traineeId }) => traineeId === trainee.id)
                ? <span key={trainee.id} className="assignment-assigned"><Check size={16} /> Назначено · {trainee.name}</span>
                : <button key={trainee.id} type="button" className="button secondary" disabled={busy}
                  aria-label={`Назначить версию ${task.instruction.version} — ${trainee.name}`}
                  onClick={() => assign(version, trainee)}><Plus size={16} /> {trainee.name}</button>)}
            </div>
          </li>;
        })}</ul>
      </section> : null}
    </main>
  );
}
