import { useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, MessageSquare, MessagesSquare, RefreshCw, Users } from 'lucide-react';
import { taskClarificationSections, type DemoIdentity, type TaskClarification, type TaskVersion } from '../shared/contracts';
import { compareInsight, taskInsights } from '../shared/task-insights';

type Section = TaskClarification['section'];
const sections = Object.keys(taskClarificationSections) as Section[];

function comparison(current?: TaskVersion, previous?: TaskVersion) {
  if (!current || !previous) return;
  const older = previous.participants.filter(({ started, traineeId }) => started
    && current.participants.some((item) => item.started && item.traineeId === traineeId));
  const newer = current.participants.filter(({ traineeId }) => older.some((item) => item.traineeId === traineeId));
  if (older.length < 2) return;
  return {
    size: older.length,
    before: older.filter(({ clarification }) => clarification).length,
    after: newer.filter(({ clarification }) => clarification).length,
  };
}

export function TaskClarityReport({ versions, trainees, initialVersion, busy, refreshing, onClarify, onRefresh }: {
  versions: TaskVersion[]; trainees: DemoIdentity[]; busy: boolean; refreshing: boolean;
  initialVersion: string | null; onRefresh: () => void;
  onClarify: (version: TaskVersion, section: Section) => void;
}) {
  const [selectedId, setSelectedId] = useState(initialVersion);
  const [latest, previous] = versions;
  const selected = versions.find(({ task }) => task.id === selectedId)
    ?? versions.find(({ participants }) => participants.some(({ clarification }) => clarification)) ?? latest;
  const groups = sections.map((section) => ({ section, questions: selected.participants
    .filter(({ clarification }) => clarification?.section === section) }))
    .filter(({ questions }) => questions.length)
    .sort((a, b) => b.questions.length - a.questions.length);
  const result = comparison(latest, previous);
  const insights = taskInsights(selected.task, selected.participants);
  const delta = result ? Math.round((result.after - result.before) * 100 / result.size) : 0;
  const deltaText = delta ? `${delta < 0 ? '−' : '+'}${Math.abs(delta)} п.п.` : 'Без изменений';
  const Trend = delta < 0 ? ArrowDownRight : delta > 0 ? ArrowUpRight : ArrowRight;

  return <section className="surface clarity-report" aria-labelledby="clarity-heading">
    <header className="clarity-heading">
      <div className="clarity-intro">
        <span className="clarity-mark" aria-hidden="true"><MessagesSquare size={23} /></span>
        <div><h2 id="clarity-heading">Понятность поручения</h2>
          <p>Какие разделы вызвали вопросы и как изменилась их частота.</p>
        </div>
      </div>
      <button type="button" className="button secondary clarity-refresh" aria-label="Обновить сводку"
        title="Обновить сводку" aria-busy={refreshing} disabled={busy} onClick={onRefresh}>
        <RefreshCw size={17} aria-hidden="true" /><span>{refreshing ? 'Обновляем…' : 'Обновить'}</span>
      </button>
    </header>
    <div className="clarity-columns">
      <section className="clarity-questions" aria-labelledby="clarity-questions-heading">
        <div className="clarity-subhead">
          <h3 id="clarity-questions-heading">Вопросы по разделам</h3>
          {versions.length > 1 ? <select aria-label="Версия вопросов" value={selected.task.id}
            onChange={(event) => setSelectedId(event.target.value)}>
            {versions.map(({ task }) => <option key={task.id} value={task.id}>Версия {task.instruction.version}</option>)}
          </select> : <span className="clarity-version">Версия {selected.task.instruction.version}</span>}
        </div>
        <div className="clarity-question-list" key={selected.task.id}>
          {groups.length ? groups.map(({ section, questions }, index) =>
            <details className="clarity-group" key={section} open={index === 0}>
              <summary>
                <span className="clarity-section-mark" data-section={section}><MessageSquare size={15} aria-hidden="true" /></span>
                <strong>{taskClarificationSections[section]}</strong>
                <span className="clarity-count">{questions.length === 1 ? '1 вопрос' : `${questions.length} вопроса`}</span>
                <ChevronDown size={14} className="disclosure" aria-hidden="true" />
              </summary>
              <div className="clarity-group-body">
                <ul>{questions.map(({ traineeId, clarification }) => {
                  const name = trainees.find(({ id }) => id === traineeId)?.name;
                  return <li key={traineeId}>
                    <span className="clarity-avatar" aria-hidden="true">{name?.split(' ').at(-1)?.charAt(0) ?? 'С'}</span>
                    <div><strong>{name ?? 'Стажёр'}</strong><p>{clarification?.text}</p></div>
                  </li>;
                })}</ul>
                {insights.filter((insight) => insight.section === section).map((insight) => {
                  const count = latest.task.id === selected.task.id ? undefined : compareInsight(insight, selected, latest);
                  return <div className="clarity-observation" key={insight.checkId}>
                    <strong>Совпадение в первых попытках</strong><p>{insight.text}</p>
                    {count && <p className="fact">В версии {latest.task.instruction.version} повторилось у {count.repeated} из {count.total} тех же участников.</p>}
                  </div>;
                })}
                <button type="button" className="text-link clarity-edit" disabled={busy} onClick={() => onClarify(selected, section)}>
                  Уточнить в черновике <ArrowUpRight size={16} />
                </button>
              </div>
            </details>
          ) : <p className="clarity-empty">{selected.participants.length
            ? 'По этой версии пока нет вопросов.' : 'Назначь версию, чтобы стажёры могли задать вопросы.'}</p>}
        </div>
      </section>
      <section className="clarity-comparison" aria-labelledby="clarity-comparison-heading">
        <h3 id="clarity-comparison-heading">Сравнение версий</h3>
        {result && previous ? <>
          <div className="clarity-metric" key={`${previous.task.id}/${latest.task.id}/${delta}`}>
            <span className="clarity-delta" data-number={delta !== 0}>{deltaText}</span>
            <span className="clarity-trend"><Trend size={23} aria-hidden="true" /></span>
          </div>
          <p className="clarity-metric-caption">Доля стажёров, задавших вопрос</p>
          <div className="clarity-chart">
            {([ { version: previous, count: result.before }, { version: latest, count: result.after } ]).map(({ version, count }) =>
              <div className="clarity-bar-row" key={version.task.id}>
                <span>v{version.task.instruction.version}</span>
                <div className="clarity-track" aria-hidden="true"><i style={{ width: `${count * 100 / result.size}%` }} /></div>
                <strong>{count} из {result.size}</strong>
              </div>
            )}
          </div>
          <p className="clarity-cohort"><Users size={16} aria-hidden="true" />
            <span>Учтены те, кто в обеих версиях сохранил выбор, запустил проверку или задал вопрос.</span>
          </p>
        </> : <div className="clarity-empty">
          <strong>{previous ? 'Недостаточно данных' : 'Доступна одна версия'}</strong>
          <p>{previous ? 'Сравнение появится после действий двух стажёров в обеих версиях.'
            : 'Опубликуй следующую версию и назначь её тем же стажёрам.'}</p>
        </div>}
      </section>
    </div>
  </section>;
}
