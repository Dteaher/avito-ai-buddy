import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, CircleAlert, ListChecks, LoaderCircle } from 'lucide-react';
import { cities, type BuddyQuestion, type CheckDraft, type CheckId, type City, type Preparation, type Publication, type Run, type Workspace as WorkspaceData } from '../shared/contracts';
import heroImage from './assets/search-shapes.webp';
import { errorMessage, post } from './api';
import { Buddy, InstructionDialog, showInstruction } from './Buddy';
import { Evidence, RunContext } from './Evidence';
import { PriceOrderInput } from './PriceOrder';
import { Conclusion } from './Conclusion';

const stages = ['Правило', 'Ожидание', 'Проверить', 'Передать'];
type Choices = Partial<Record<CheckId, City[]>>;

export function NextTask() {
  return (
    <aside className="next-task">
      <div><strong>Следующая задача · SORT-01</strong><p>Задай ожидаемый порядок объявлений по инструкции команды. Buddy поможет, если возникнет вопрос.</p></div>
      <a className="button secondary" href="/?task=SORT-01">Продолжить самостоятельно <ArrowRight size={18} /></a>
    </aside>
  );
}

export function Workspace({ data, mode, chooseMode }: {
  data: WorkspaceData; mode?: BuddyQuestion['mode']; chooseMode: (mode: BuddyQuestion['mode']) => void;
}) {
  const { task } = data;
  const priceTask = data.kind === 'price-order';
  const taskPath = `/api/tasks/${task.id}`;
  const [stage, setStage] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [choices, setChoices] = useState<Choices>({});
  const [order, setOrder] = useState<string[]>([]);
  const [preparation, setPreparation] = useState<Preparation>();
  const [conclusion, setConclusion] = useState('');
  const [run, setRun] = useState<Run>();
  const [publication, setPublication] = useState<Publication>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [animateResult, setAnimateResult] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const recordLink = useRef<HTMLAnchorElement>(null);
  const shouldFocus = useRef(false);
  const actionReady = priceTask ? order.length === data.orderItems.length : data.checks.every(({ id }) => choices[id] !== undefined);

  useEffect(() => {
    if (shouldFocus.current) {
      shouldFocus.current = false;
      heading.current?.focus();
    }
  }, [stage]);

  useEffect(() => {
    if (publication && document.activeElement === document.body) recordLink.current?.focus({ preventScroll: true });
  }, [publication]);

  function move(next: number) {
    shouldFocus.current = next !== stage;
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

  function applyDraft(draft: CheckDraft, question: string) {
    if (busy || run) return;
    const choices: Choices = {};
    for (const check of draft.checks) {
      if ('expectedOrder' in check) setOrder(check.expectedOrder);
      else choices[check.id] = check.expectedCities;
    }
    setChoices(choices);
    setPreparation({ source: 'buddy-draft', question, checkId: draft.checkId });
    move(1);
    heading.current?.focus();
  }

  async function launch() {
    if (busy || !actionReady) return;
    setBusy(true);
    setFailure('');
    try {
      const result = await post<Run>(`${taskPath}/runs`, {
        checks: priceTask ? [{ id: data.checks[0].id, expectedOrder: order }]
          : data.checks.map(({ id }) => ({ id, expectedCities: choices[id] })),
        preparation,
      });
      setRun(result);
      setConclusion('');
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
      setPublication(await post<Publication>(`${taskPath}/runs/${run.id}/publication`, { conclusion }));
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
          <span className="task-key">{task.id}</span>
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
      <div className="workflow-tools">
        <label>Режим проверки <select value={data.buddyMode === 'guide' && mode === 'guide' ? '' : mode ?? ''}
          onChange={(event) => chooseMode(event.target.value === 'manual' ? 'manual' : event.target.value === 'guide' ? 'guide' : undefined)}>
          {data.buddyMode === 'model' && <option value="">Buddy · {data.buddyProvider === 'local' ? 'локальная LLM' : 'LLM'}</option>}
          <option value={data.buddyMode === 'model' ? 'guide' : ''}>Демо-справка</option>
          <option value="manual">Без Buddy</option>
        </select></label>
        {data.identity && <a className="text-link" href="/?records=1">Мои записи <ArrowUpRight size={15} /></a>}
      </div>
      <nav className="steps" aria-label="Этапы проверки">
        <ol style={{ '--stage-offset': `${stage * 100}%` } as CSSProperties}>{stages.map((label, index) => {
          const current = index === stage;
          const done = index < furthest || Boolean(publication);
          return (
            <li key={label} className={done ? 'done' : undefined}>
              <button type="button" disabled={busy || index > furthest} aria-current={current ? 'step' : undefined}
                aria-description={done ? 'Этап завершён' : undefined} onClick={() => move(index)}>
                <span className="step-count" aria-hidden="true">{done ? <Check size={15} /> : index + 1}</span><span>{label}</span>
              </button>
            </li>
          );
        })}
          <li>{publication ? <a className="review-step" href={publication.url}><span className="step-count" aria-hidden="true">5</span><span>Ревью</span></a>
            : <button type="button" disabled><span className="step-count" aria-hidden="true">5</span><span>Ревью</span></button>}</li>
        </ol>
      </nav>

      <div className="workspace-grid" data-has-result={Boolean(run)}>
        <Buddy workspace={data} openSource={openSource} run={run} collapsible mode={mode}
          intent={stage === 1 ? 'plan' : undefined} onDraft={busy ? undefined : applyDraft} orderItems={priceTask ? data.orderItems : undefined} />
        <section className="surface work-panel" aria-labelledby="stage-title">
          <span className="visually-hidden" aria-live="polite">
            {busy ? (stage === 1 ? 'Запускаем проверку…' : 'Публикуем…') : publication ? 'Опубликовано' : ''}
          </span>
          {stage === 0 && (
            <>
              <div className="panel-heading"><h2 id="stage-title" tabIndex={-1} ref={heading}>Что проверяем</h2></div>
              <p className="stage-intro">{task.description}</p>
              <p className="first-task-note">Первая задача в команде поиска. Подготовь проверку API, зафиксируй результат и передай его наставнику.</p>
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
              <details className="response-details rule-expectation">
                <summary>Ожидание по инструкции</summary>
                <p>{task.criterion}</p>
                <button type="button" className="text-link" onClick={() => openSource()}>Открыть пункты инструкции <ArrowUpRight size={15} /></button>
              </details>
              {preparation && <p className="fallback-note" role="status">Черновик в форме. Проверь ожидание и при необходимости измени его.</p>}
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
                <button type="button" className="button primary run-action" disabled={!actionReady} aria-disabled={busy || undefined} onClick={() => void launch()}>
                  {busy ? 'Запускаем проверку…' : failure ? 'Повторить проверку' : 'Запустить проверку'}
                  {busy ? <LoaderCircle size={18} className="spinner" /> : <ArrowRight size={19} />}
                </button>
              </div>
            </>
          )}
          {stage >= 2 && run && (
            <>
              <div className="panel-heading">
                <h2 id="stage-title" tabIndex={-1} ref={heading}>{stage === 2 || publication ? 'Результат проверки' : 'Предпросмотр'}</h2>
              </div>
              <div id="result-evidence"><Evidence key={run.id} run={run} animate={animateResult} /></div>
              {stage === 2 && !publication && <Conclusion key={run.id} run={run} value={conclusion} onChange={setConclusion} openRule={openSource} mode={mode} />}
              {stage === 3 && !publication && conclusion.trim() && <p className="record-conclusion"><strong>Твой вывод</strong>{conclusion}</p>}
              {stage === 3 && <details className="response-details">
                <summary>Данные записи для трекера · {task.id} <ChevronDown size={17} className="disclosure" /></summary>
                <RunContext run={run} />
              </details>}
              {failure && <p className="action-error" role="alert"><CircleAlert size={19} />{failure}</p>}
              <div className="actions" key={stage}>
                {stage === 2 ? (
                  <>
                    <button type="button" className="button primary" onClick={() => move(3)}>
                      {publication ? 'Открыть публикацию' : 'Опубликовать в задачу'} <ArrowRight size={19} />
                    </button>
                    <button type="button" className="button secondary" onClick={() => move(1)}>Изменить ожидания</button>
                  </>
                ) : (
                  <>
                    {publication ? (
                      <a ref={recordLink} className="button primary publish-action publication-link" href={publication.url}
                        aria-label={`Открыть запись ${publication.id}`} aria-describedby="published-status">
                        <Check size={19} /><span><span id="published-status">Опубликовано</span><small>Открыть запись</small></span><ArrowUpRight size={19} />
                      </a>
                    ) : (
                      <button type="button" className="button primary publish-action" aria-disabled={busy || undefined} onClick={() => void publish()}>
                        {busy ? 'Публикуем…' : failure ? 'Повторить публикацию' : 'Подтвердить публикацию'}
                        {busy ? <LoaderCircle size={18} className="spinner" /> : <ArrowRight size={19} />}
                      </button>
                    )}
                    <button type="button" className="button secondary" disabled={busy} onClick={() => move(2)}><ArrowLeft size={17} /> К результату</button>
                  </>
                )}
              </div>
              {stage === 3 && publication && !priceTask && <NextTask />}
              {publication && <p className="first-task-note">Запись сохранена. Открой её, чтобы увидеть решение наставника.</p>}
            </>
          )}
        </section>
      </div>
      <InstructionDialog instruction={task.instruction} dialog={dialog} />
    </main>
  );
}
