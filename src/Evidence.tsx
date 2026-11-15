import { Check, ChevronDown, CircleAlert, Clock3, Terminal, X } from 'lucide-react';
import { cities, type CheckResult, type PriceResult, type Run, type RunEvidenceSource } from '../shared/contracts';
import { PriceComparison, priceLabel } from './PriceOrder';
import { responseFollowsRule } from '../shared/run-summary';

type ResponseCheck = CheckResult | PriceResult;

export function formatTime(time: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(time));
}

function RequestLine({ check }: { check: ResponseCheck }) {
  return <span className="endpoint"><span>GET</span><code>{check.path}</code></span>;
}

function Comparison({ check }: { check: CheckResult }) {
  const comparedCities = [...new Set([...check.expectedCities, ...check.actualCities])];
  return (
    <>
      <table className="city-comparison" aria-label="Сравнение городов">
        <thead><tr><th scope="col">Ожидали</th><th scope="col">Стенд вернул</th></tr></thead>
        <tbody>
          {!comparedCities.length && <tr><td>Пустая выдача</td><td>Пустая выдача</td></tr>}
          {comparedCities.map((city) => {
            const missing = check.missing.includes(city);
            const extra = check.extra.includes(city);
            return (
              <tr key={city}>
                <td>{extra ? '—' : cities[city]}</td>
                <td className={missing || extra ? 'city-mismatch' : 'city-match'}>
                  <div className="city-value">
                    {missing || extra ? <CircleAlert size={18} /> : <Check size={18} />}
                    <span>{cities[city]}{missing ? ' отсутствует' : extra ? ' — лишний город' : ''}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={`comparison-verdict ${check.matches ? 'ok' : 'bad'}`}>
        {check.matches ? <Check size={20} /> : <CircleAlert size={20} />}
        <strong>{check.matches ? 'Совпало' : 'Найдено расхождение'}</strong>
      </div>
      {!check.followsRule && (
        <p className="rule-warning"><CircleAlert size={18} /> По тестовой инструкции ожидаем {check.ruleCities.map((city) => cities[city]).join(' и ')}.</p>
      )}
    </>
  );
}

function ResponseBody({ check }: { check: ResponseCheck }) {
  return (
    <div className="response-body">
      <p>Параметр <code>{check.parameter}</code></p>
      {check.items.length ? (
        <ul className="listings">{check.items.map((item, index) => (
          <li key={`${item.id}-${index}`}><strong>{item.title}</strong><span>{'price' in item ? priceLabel(item.price) : cities[item.city]} · <code>{item.id}</code></span></li>
        ))}</ul>
      ) : <p>Стенд вернул пустой список объявлений.</p>}
      <details className="raw"><summary>Сырое тело ответа <ChevronDown size={15} className="disclosure" /></summary><pre>{check.rawBody}</pre></details>
    </div>
  );
}

function ResponseDetails({ check }: { check: ResponseCheck }) {
  return (
    <details className="response-details">
      <summary><Terminal size={16} /> Подробности ответа <ChevronDown size={17} className="disclosure" /></summary>
      <ResponseBody check={check} />
    </details>
  );
}

function RuleDifference({ check }: { check: ResponseCheck }) {
  const follows = responseFollowsRule(check);
  return check.matches === follows ? null : (
    <p className="fact"><strong>Ответ по правилу</strong> · {follows ? 'соответствует инструкции' : 'расходится с инструкцией'}.</p>
  );
}

function CityEvidence({ check, label = check.label, anchor }: { check: CheckResult; label?: string; anchor?: string }) {
  return (
    <section id={anchor} aria-label={label}>
      <div className="request-heading"><RequestLine check={check} /><span className="http-status">HTTP {check.status}</span></div>
      <Comparison check={check} />
      <RuleDifference check={check} />
      <ResponseDetails check={check} />
    </section>
  );
}

export function Evidence({ run, animate = false, checkId, anchorPrefix }: {
  run: Run; animate?: boolean; checkId?: RunEvidenceSource['checkId']; anchorPrefix?: string;
}) {
  const anchor = (id: string) => anchorPrefix ? `${anchorPrefix}-${id}` : undefined;
  if (run.kind === 'price-order') {
    const [check] = run.checks;
    return (
      <section id={anchor(check.id)} className={`evidence${animate ? ' reveal' : ''}`} aria-label="Основной запрос">
        <div className="request-heading"><RequestLine check={check} /><span className="http-status">HTTP {check.status}</span></div>
        <PriceComparison check={check} animate={animate} />
        <RuleDifference check={check} />
        <ResponseDetails check={check} />
      </section>
    );
  }
  const [primary, control] = run.checks;
  if (checkId) return <div className="evidence"><CityEvidence check={checkId === control.id ? control : primary} /></div>;
  return (
    <div className={`evidence${animate ? ' reveal' : ''}`}>
      <CityEvidence check={primary} label="Основной запрос" anchor={anchor(primary.id)} />
      <details id={anchor(control.id)} className="control-details">
        <summary>
          <span className="control-label"><strong>Контрольный запрос</strong><span>{control.label}</span></span>
          <span className={`verdict-chip ${control.matches ? 'ok' : 'bad'}`}>
            {control.matches ? <Check size={16} /> : <X size={16} />}{control.matches ? 'Совпало' : 'Расхождение'}
          </span>
          <ChevronDown size={18} className="disclosure" />
        </summary>
        <div className="control-body">
          <div className="request-heading"><RequestLine check={control} /><span className="http-status">HTTP {control.status}</span></div>
          <Comparison check={control} />
          <RuleDifference check={control} />
          <ResponseBody check={control} />
        </div>
      </details>
    </div>
  );
}

export function RunContext({ run, showRules = false }: { run: Run; showRules?: boolean }) {
  const { instruction } = run.task;
  return (
    <div className="run-context">
      <div><span className="field-label">Критерий задачи</span><p>{run.task.criterion}</p></div>
      <div><span className="field-label">Тестовая инструкция</span><p>{instruction.title} · v{instruction.version}</p></div>
      <span className="run-time"><Clock3 size={15} /> Прогон <time dateTime={run.checkedAt}>{formatTime(run.checkedAt)}</time></span>
      {showRules && <details className="response-details"><summary>Правила команды <ChevronDown size={17} className="disclosure" /></summary><ol>{instruction.rules.map((rule) => <li key={rule}>{rule}</li>)}</ol></details>}
    </div>
  );
}
