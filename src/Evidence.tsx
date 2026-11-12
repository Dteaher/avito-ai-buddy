import { ArrowRight, Check, ChevronDown, CircleAlert, Clock3, Terminal, X } from 'lucide-react';
import { cities, type CheckResult, type City, type PriceResult, type Run, type RunEvidenceSource } from '../shared/contracts';
import { PriceComparison, priceLabel } from './PriceOrder';

type ResponseCheck = CheckResult | PriceResult;

export function formatTime(time: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(time));
}

function RequestLine({ check }: { check: ResponseCheck }) {
  return <span className="endpoint"><span>GET</span><code>{check.path}</code></span>;
}

function CityColumn({ name, list, missing = [], extra = [] }: { name: string; list: City[]; missing?: City[]; extra?: City[] }) {
  return (
    <div className="city-column">
      <h4>{name}</h4>
      <ul>
        {!list.length && <li className="city-row neutral">Пустая выдача</li>}
        {list.map((city) => (
          <li key={city} className={`city-row ${extra.includes(city) ? 'bad' : 'ok'}`}>
            {extra.includes(city) ? <CircleAlert size={19} /> : <Check size={19} />}
            <span>{cities[city]}{extra.includes(city) && ' — лишний город'}</span>
          </li>
        ))}
        {missing.map((city) => (
          <li key={city} className="city-row bad missing"><CircleAlert size={19} /><span>{cities[city]} отсутствует</span></li>
        ))}
      </ul>
    </div>
  );
}

function Comparison({ check }: { check: CheckResult }) {
  return (
    <>
      <div className="city-comparison">
        <CityColumn name="Ожидали" list={check.expectedCities} />
        <ArrowRight className="comparison-arrow" size={20} aria-hidden="true" />
        <CityColumn name="Стенд вернул" list={check.actualCities} missing={check.missing} extra={check.extra} />
      </div>
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
      <summary><Terminal size={16} /> Ответ стенда · HTTP {check.status} <ChevronDown size={17} className="disclosure" /></summary>
      <ResponseBody check={check} />
    </details>
  );
}

function CityEvidence({ check, label = check.label }: { check: CheckResult; label?: string }) {
  return (
    <section aria-label={label}>
      <div className="request-heading"><RequestLine check={check} /><span className="http-status">HTTP {check.status}</span></div>
      <Comparison check={check} />
      <ResponseDetails check={check} />
    </section>
  );
}

export function Evidence({ run, animate = false, checkId }: { run: Run; animate?: boolean; checkId?: RunEvidenceSource['checkId'] }) {
  if (run.kind === 'price-order') {
    const [check] = run.checks;
    return (
      <section className={`evidence${animate ? ' reveal' : ''}`} aria-label="Основной запрос">
        <div className="request-heading"><RequestLine check={check} /><span className="http-status">HTTP {check.status}</span></div>
        <PriceComparison check={check} />
        <ResponseDetails check={check} />
      </section>
    );
  }
  const [primary, control] = run.checks;
  if (checkId) return <div className="evidence"><CityEvidence check={checkId === control.id ? control : primary} /></div>;
  return (
    <div className={`evidence${animate ? ' reveal' : ''}`}>
      <CityEvidence check={primary} label="Основной запрос" />
      <details className="control-details">
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
