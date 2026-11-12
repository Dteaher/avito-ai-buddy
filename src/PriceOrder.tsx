import { CircleAlert, Undo2 } from 'lucide-react';
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

export function PriceComparison({ check }: { check: PriceResult }) {
  const noPrice = check.fixtures.find(({ price }) => price === null);
  const expectedPosition = noPrice ? check.expectedOrder.indexOf(noPrice.id) : -1;
  const actualPosition = noPrice ? check.actualOrder.indexOf(noPrice.id) : -1;
  const moved = expectedPosition >= 0 && actualPosition >= 0 && expectedPosition !== actualPosition;
  const verdict = check.matches ? 'Порядок совпал с ожиданием.' : check.sameItems ? 'Состав совпал. Порядок отличается.' : 'Состав выдачи отличается.';

  return (
    <>
      <div className={`order-verdict ${check.matches ? 'ok' : 'bad'}`}>
        <strong>{verdict}</strong>
        {moved && <p>Объявление без цены на {actualPosition + 1}-м месте вместо {expectedPosition + 1}-го.</p>}
      </div>
      <div className="order-comparison">
        <OrderColumn title="Ожидали" order={check.expectedOrder} items={check.fixtures} />
        <OrderColumn title="Стенд вернул" order={check.actualOrder} items={check.items} highlight={moved ? actualPosition : -1} />
      </div>
      {!check.followsRule && <p className="rule-warning"><CircleAlert size={18} /> По инструкции сначала идут числовые цены по возрастанию, затем объявление без цены.</p>}
    </>
  );
}
