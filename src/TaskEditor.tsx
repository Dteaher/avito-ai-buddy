import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus } from 'lucide-react';
import { groupLabels, type CheckId, type TaskDraftInput, type TaskEditorData, type TaskProject, type TaskVersion } from '../shared/contracts';
import { errorMessage, post, request } from './api';

const endpoint = '/api/mentor/tasks';
const blank: TaskDraftInput = { title: '', description: '', criterion: '', checkIds: [] };

export function TaskEditor() {
  const [data, setData] = useState<TaskEditorData>();
  const [projectId, setProjectId] = useState<string>();
  const [input, setInput] = useState<TaskDraftInput | undefined>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const project = data?.projects.find(({ id }) => id === projectId);
  const latest = project?.versions[0];
  const saved = project?.draft;
  const preview = input ?? latest?.input;
  const valid = input && Boolean(input.title.trim() && input.description.trim() && input.criterion.trim() && input.checkIds.length);
  const started = input && Boolean(input.title.trim() || input.description.trim() || input.criterion.trim() || input.checkIds.length);
  const savedInput = saved && JSON.stringify(input) === JSON.stringify(saved.input);
  const trainee = data?.trainees[0];

  useEffect(() => {
    const controller = new AbortController();
    void request<TaskEditorData>(endpoint, { signal: controller.signal }).then(setData, (reason: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    });
    return () => controller.abort();
  }, []);

  function openProject(next?: TaskProject) {
    setProjectId(next?.id);
    setInput(next ? next.draft?.input : blank);
    setError('');
    setNotice('');
  }

  async function change(operation: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const message = await operation();
      setData(await request<TaskEditorData>(endpoint));
      setNotice(message);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!input || (!started && !saved)) return;
    void change(async () => {
      if (project) {
        await post(`${endpoint}/${project.id}/draft`, { ...input, basedOn: saved?.revision ?? String(latest?.version) });
      } else {
        const created = await post<TaskProject>(endpoint, input);
        setProjectId(created.id);
      }
      setInput({ ...input, title: input.title.trim(), description: input.description.trim(), criterion: input.criterion.trim() });
      return 'Черновик сохранён.';
    });
  }

  function publish() {
    if (!project || !saved || !savedInput || !valid) return;
    void change(async () => {
      await post(`${endpoint}/${project.id}/publish`, { revision: saved.revision });
      setInput(undefined);
      return 'Версия опубликована. Выбери её для назначения.';
    });
  }

  function assign(version: TaskVersion) {
    if (!trainee) return;
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
        <div><h1>Создать поручение</h1><p>Сформулируй цель и выбери, что стенд проверит автоматически.</p></div>
        {project && <button className="button secondary" type="button" disabled={busy} onClick={() => openProject()}><Plus size={17} /> Новое поручение</button>}
      </div>
      {data?.projects.length ? <label className="editor-projects">Сохранённые поручения
        <select value={projectId ?? ''} disabled={busy} onChange={(event) => openProject(data.projects.find(({ id }) => id === event.target.value))}>
          <option value="">Новое поручение</option>
          {data.projects.map(({ id, draft, versions }) => <option key={id} value={id}>
            {draft?.input.title ?? versions[0]?.task.title} {draft ? '· черновик' : `· v${versions[0]?.task.instruction.version}`}
          </option>)}
        </select>
      </label> : null}
      {error && <p className="action-error" role="alert">{error}</p>}
      {notice && <p className="editor-notice" role="status"><Check size={17} /> {notice}</p>}
      {!data && !error && <p role="status">Загружаем каталог проверок…</p>}
      {data && <div className="editor-grid">
        {input ? <form className="surface record-surface editor-form" onSubmit={save}>
          <h2>{project ? 'Черновик поручения' : 'Новое поручение'}</h2>
          <div className="editor-field"><label htmlFor="editor-title">Название</label>
            <input id="editor-title" maxLength={80} value={input.title} disabled={busy}
              onChange={(event) => setInput({ ...input, title: event.target.value })} />
          </div>
          <div className="editor-field"><label htmlFor="editor-description">Описание</label>
            <textarea id="editor-description" rows={3} maxLength={600} value={input.description} disabled={busy}
              onChange={(event) => setInput({ ...input, description: event.target.value })} />
          </div>
          <div className="editor-field"><label htmlFor="editor-criterion">Критерий успеха</label>
            <textarea id="editor-criterion" rows={2} maxLength={240} value={input.criterion} disabled={busy}
              onChange={(event) => setInput({ ...input, criterion: event.target.value })} />
          </div>
          <fieldset disabled={busy}>
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
          <div><button type="button" className="button secondary" disabled={busy} onClick={() => setInput(latest?.input)}>Править в новом черновике</button></div>
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
        {trainee && <p className="fact">Получатель · {trainee.name}</p>}
        <ul>{project.versions.map((version) => <li key={version.task.id}>
          <div><strong>v{version.task.instruction.version} · {version.task.title}</strong><p>{version.task.criterion}</p></div>
          {version.assigned ? <span className="assignment-assigned"><Check size={17} /> Назначено · {trainee?.name}</span>
            : <button type="button" className="button primary" disabled={busy || !trainee} onClick={() => assign(version)}>Назначить версию {version.task.instruction.version}</button>}
        </li>)}</ul>
      </section> : null}
    </main>
  );
}
