import { useLayoutEffect, useRef } from 'react';
import { Check, CircleAlert, Undo2 } from 'lucide-react';
import type { PriceCheck, PriceListing, PriceResult } from '../shared/contracts';

export function priceLabel(price: number | null) {
  return price === null ? 'Без цены' : `${price} ₽`;
}

export function PriceOrderInput({ check, items, order, disabled, onChange }: {
  check: PriceCheck; items: PriceListing[]; order: string[]; disabled: boolean; onChange: (order: string[]) => void;
}) {
  return (
    <fieldset className="expectation" disabled={disabled}>
      <legend>Основной запрос</legend>
      <span className="endpoint"><span>GET</span><code>{check.path}</code></span>
      <p className="field-label">Выбери объявления от первого к последнему</p>
      <div className="order-options">
        {items.map((item) => {
          const selected = order.includes(item.id);
          return (
            <button className="order-option" key={item.id} type="button" aria-disabled={selected} onClick={() => {
              if (!selected) onChange([...order, item.id]);
            }}>
              <strong>{priceLabel(item.price)}</strong><span>{selected ? 'Выбрано' : item.title}</span>
            </button>
          );
        })}
      </div>
      <div className="order-draft" aria-live="polite">
        <h3>Ожидаемый порядок</h3>
        <ol>{items.map((_, index) => {
          const item = items.find(({ id }) => id === order[index]);
          return <li key={index}>{item ? `${priceLabel(item.price)} · ${item.title}` : 'Место свободно'}</li>;
        })}</ol>
      </div>
      <button type="button" className="text-link order-undo" disabled={!order.length} onClick={() => onChange(order.slice(0, -1))}>
        <Undo2 size={16} /> Отменить последний выбор
      </button>
    </fieldset>
  );
}

function OrderColumn({ title, order, items, highlight = -1 }: { title: string; order: string[]; items: PriceListing[]; highlight?: number }) {
  return (
    <div className="order-column">
      <h4>{title}</h4>
      {order.length ? <ol>{order.map((id, index) => {
        const item = items.find((candidate) => candidate.id === id);
        return (
          <li className={index === highlight ? 'order-row moved' : 'order-row'} key={`${id}-${index}`}>
            <span className="order-index" aria-hidden="true">{index + 1}</span>
            <div><strong>{item ? priceLabel(item.price) : id}</strong>{item && <span>{item.title}</span>}</div>
          </li>
        );
      })}</ol> : <p>Пустая выдача</p>}
    </div>
  );
}

export function PriceComparison({ check, animate = false }: { check: PriceResult; animate?: boolean }) {
  const comparison = useRef<HTMLDivElement>(null);
  const connector = useRef<HTMLSpanElement>(null);
  const moves = check.actualOrder.flatMap((id, actual) => {
    const expected = check.expectedOrder.indexOf(id);
    const item = check.fixtures.find((fixture) => fixture.id === id);
    return item && expected !== -1 && expected !== actual ? [{ item, expected, actual }] : [];
  });
  const moved = moves.find(({ item }) => item.price === null) ?? moves[0];
  const verdict = check.matches ? 'Порядок совпал с ожиданием.' : check.sameItems ? 'Состав совпал. Порядок отличается.' : 'Состав выдачи отличается.';

  useLayoutEffect(() => {
    const columns = comparison.current;
    const marker = connector.current;
    if (!animate || !columns || !marker) return;
    const [from, to] = columns.querySelectorAll('.moved');
    if (!from || !to) return;
    const top = columns.getBoundingClientRect().top;
    function center(row: Element) {
      const rect = row.getBoundingClientRect();
      return `${rect.top - top + rect.height / 2}px`;
    }
    marker.style.setProperty('--from-y', center(from));
    marker.style.setProperty('--to-y', center(to));
  }, [animate, moved?.expected, moved?.actual]);

  return (
    <>
      <div className={`order-verdict ${check.matches ? 'ok' : 'bad'}`}>
        {check.matches ? <Check size={20} /> : <CircleAlert size={20} />}
        <div>
          <strong>{verdict}</strong>
          {moved && <p>{moved.item.price === null ? 'Объявление без цены' : moved.item.title} на {moved.actual + 1}-м месте вместо {moved.expected + 1}-го.</p>}
        </div>
      </div>
      <div className="order-comparison" ref={comparison}>
        <OrderColumn title="Ожидали" order={check.expectedOrder} items={check.fixtures} highlight={moved?.expected} />
        <OrderColumn title="Стенд вернул" order={check.actualOrder} items={check.items} highlight={moved?.actual} />
        {animate && moved && <span className="order-connector" ref={connector} aria-hidden="true" />}
      </div>
      {!check.followsRule && <p className="rule-warning"><CircleAlert size={18} /> По инструкции сначала идут числовые цены по возрастанию, затем объявление без цены.</p>}
    </>
  );
}
