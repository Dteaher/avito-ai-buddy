import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CircleAlert, CircleCheck, ListChecks, LoaderCircle, Terminal } from 'lucide-react';
import { cities, type CheckId, type City, type Publication, type Run, type Workspace as WorkspaceData } from '../shared/contracts';
import heroImage from './assets/search-shapes.webp';
import { errorMessage, post } from './api';
import { Buddy, InstructionDialog, showInstruction } from './Buddy';
import { Evidence, RunContext } from './Evidence';
import { PriceOrderInput } from './PriceOrder';

const stages = ['Разобраться', 'Подготовить', 'Проверить', 'Опубликовать'];
type Choices = Partial<Record<CheckId, City[]>>;

export function NextTask() {
  return (
    <aside className="next-task">
      <div><strong>Следующая задача · SORT-01</strong><p>Задай ожидаемый порядок объявлений по инструкции команды. Buddy поможет, если возникнет вопрос.</p></div>
      <a className="button secondary" href="/?task=SORT-01">Продолжить самостоятельно <ArrowRight size={18} /></a>
    </aside>
  );
}

export function Workspace({ data }: { data: WorkspaceData }) {
  const { task } = data;
  const priceTask = data.kind === 'price-order';
  const taskPath = `/api/tasks/${task.id}`;
  const [stage, setStage] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [choices, setChoices] = useState<Choices>({});
  const [order, setOrder] = useState<string[]>([]);
  const [run, setRun] = useState<Run>();
  const [publication, setPublication] = useState<Publication>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [animateResult, setAnimateResult] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shouldFocus = useRef(false);
  const actionReady = priceTask ? order.length === data.orderItems.length : data.checks.every(({ id }) => choices[id] !== undefined);

  useEffect(() => {
    if (shouldFocus.current) heading.current?.focus();
  }, [stage, publication]);

  function move(next: number) {
    shouldFocus.current = true;
    setFailure('');
    setAnimateResult(false);
    setStage(next);
    setFurthest((previous) => Math.max(previous, next));
  }

  function clearResult() {
    setFailure('');
    if (run) {
      setRun(undefined);
      setPublication(undefined);
      setFurthest(1);
    }
  }

  function select(id: CheckId, city?: City) {
    const current = choices[id] ?? [];
    const selected = city ? (current.includes(city) ? current.filter((item) => item !== city) : [...current, city]) : [];
    setChoices({ ...choices, [id]: city && !selected.length ? undefined : selected });
    clearResult();
  }

  async function launch() {
    if (busy || !actionReady) return;
    setBusy(true);
    setFailure('');
    try {
      const result = await post<Run>(`${taskPath}/runs`, {
        checks: priceTask ? [{ id: data.checks[0].id, expectedOrder: order }]
          : data.checks.map(({ id }) => ({ id, expectedCities: choices[id] })),
      });
      setRun(result);
      setPublication(undefined);
      setFurthest(2);
      move(2);
      setAnimateResult(true);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (busy || !run || publication) return;
    setBusy(true);
    setFailure('');
    try {
      setPublication(await post<Publication>(`${taskPath}/runs/${run.id}/publication`));
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const openSource = (ruleNumber?: number) => showInstruction(dialog.current, ruleNumber);

  return (
    <main className="container workspace">
      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <span className="task-key"><Terminal size={15} />{task.id}</span>
          <h1 id="page-title">Первая проверка</h1>
          <p>{task.title}</p>
        </div>
        <img className="hero-image" src={heroImage} alt="" width="900" height="302" />
      </section>

      <nav className="task-nav" aria-label="Рабочие задачи">
        {data.tasks.map(({ id }) => (
          <a key={id} href={id === 'SEARCH-01' ? '/' : `/?task=${encodeURIComponent(id)}`} aria-current={id === task.id ? 'page' : undefined}>
            {id === 'SEARCH-01' ? 'Фильтр по городу' : 'Сортировка по цене'}
          </a>
        ))}
      </nav>
      <nav className="steps" aria-label="Этапы проверки">
        <ol>{stages.map((label, index) => {
          const current = index === stage;
          const done = index < furthest || Boolean(publication);
          return (
            <li key={label} className={current ? 'active' : done ? 'done' : ''}>
              <button type="button" disabled={busy || index > furthest} aria-current={current ? 'step' : undefined} onClick={() => move(index)}>
                <span className="step-count" aria-hidden="true">{done ? <Check size={15} /> : index + 1}</span><span>{label}</span>
              </button>
            </li>
          );
        })}</ol>
      </nav>

      <div className="workspace-grid">
        <section className="surface work-panel" aria-labelledby="stage-title" aria-busy={busy}>
          {stage === 0 && (
            <>
              <div className="panel-heading"><h2 id="stage-title" tabIndex={-1} ref={heading}>Разобраться в задаче</h2></div>
              <p className="stage-intro">{task.description}</p>
              {!priceTask && <div className="brief">
                <span className="brief-icon"><ListChecks size={22} /></span>
                <div><h3>Что считаем правильным</h3><p>{task.criterion}</p></div>
              </div>}
              <button type="button" className="text-link instruction-link" onClick={() => openSource()}><BookOpen size={18} /> Тестовая инструкция команды <ArrowUpRight size={15} /></button>
              <div className="actions"><button type="button" className="button primary" onClick={() => move(1)}>Подготовить проверку <ArrowRight size={19} /></button></div>
            </>
          )}
          {stage === 1 && (
            <>
              <div className="panel-heading"><h2 id="stage-title" tabIndex={-1} ref={heading}>Подготовить проверку</h2></div>
              <p className="stage-intro">{priceTask ? 'Задай ожидаемую последовательность по тестовой инструкции.' : 'Выбери, какие города должны вернуться в каждом запросе.'}</p>
              {priceTask ? <PriceOrderInput check={data.checks[0]} items={data.orderItems} order={order} disabled={busy} onChange={(next) => {
                setOrder(next);
                clearResult();
              }} /> : data.checks.map((check, index) => {
                const selected = choices[check.id];
                return (
                  <fieldset className="expectation" key={check.id} disabled={busy}>
                    <legend>{index === 0 ? 'Основной запрос' : 'Контрольный запрос'}</legend>
                    <div className="request-heading"><span className="endpoint"><span>GET</span><code>{check.path}</code></span><span className="parameter">{check.parameter}</span></div>
                    <span className="field-label">Ожидаемые города</span>
                    <div className="choices">
                      {(Object.keys(cities) as City[]).map((city) => (
                        <button type="button" key={city} aria-pressed={selected?.includes(city) ?? false} onClick={() => select(check.id, city)}>{cities[city]}</button>
                      ))}
                      <button type="button" aria-pressed={selected?.length === 0} onClick={() => select(check.id)}>Пустая выдача</button>
                    </div>
                  </fieldset>
                );
              })}
              {failure && <p className="action-error" role="alert"><CircleAlert size={19} />{failure}</p>}
              <div className="actions">
                <button type="button" className="button primary" disabled={busy || !actionReady} onClick={() => void launch()}>
                  {busy ? 'Запускаем проверку…' : 'Запустить проверку'} {busy ? <LoaderCircle size={18} className="spinner" /> : <ArrowRight size={19} />}
                </button>
              </div>
            </>
          )}
          {stage === 2 && run && (
            <>
              <div className="panel-heading"><h2 id="stage-title" tabIndex={-1} ref={heading}>Результат проверки</h2></div>
              <Evidence key={run.id} run={run} animate={animateResult} />
              <div className="actions">
                <button type="button" className="button primary" onClick={() => move(3)}>
                  {publication ? 'Открыть публикацию' : 'Опубликовать в задачу'} <ArrowRight size={19} />
                </button>
                <button type="button" className="button secondary" onClick={() => move(1)}>Изменить ожидания</button>
              </div>
            </>
          )}
          {stage === 3 && run && (
            <>
              <div className="panel-heading"><h2 id="stage-title" tabIndex={-1} ref={heading}>{publication ? 'Результат опубликован' : 'Предпросмотр записи'}</h2></div>
              {publication ? (
                <div className="published" role="status">
                  <CircleCheck size={24} />
                  <div><strong>Запись добавлена в задачу {task.id}</strong><p>Её можно открыть в тестовом трекере по постоянной ссылке.</p></div>
                </div>
              ) : <p className="stage-intro">Проверь, какие данные будут сохранены в тестовом трекере задачи {task.id}.</p>}
              <RunContext run={run} />
              {!publication && <details className="preview-evidence"><summary>Ожидания и ответы стенда</summary><Evidence run={run} /></details>}
              {failure && <p className="action-error" role="alert"><CircleAlert size={19} />{failure}</p>}
              <div className="actions">
                {publication ? (
                  <a className="button primary publication-link" href={publication.url} aria-label={`Открыть запись ${publication.id}`}>
                    <span>Открыть запись <small>{publication.id}</small></span><ArrowUpRight size={19} />
                  </a>
                ) : (
                  <button type="button" className="button primary" disabled={busy} onClick={() => void publish()}>
                    {busy ? 'Публикуем…' : 'Подтвердить публикацию'} {busy ? <LoaderCircle size={18} className="spinner" /> : <ArrowRight size={19} />}
                  </button>
                )}
                <button type="button" className="button secondary" disabled={busy} onClick={() => move(2)}><ArrowLeft size={17} /> К результату</button>
              </div>
              {publication && !priceTask && <NextTask />}
            </>
          )}
        </section>
        <Buddy workspace={data} openSource={openSource} publication={publication} run={run} />
      </div>
      <InstructionDialog instruction={task.instruction} dialog={dialog} />
    </main>
  );
}
