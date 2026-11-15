import { checkRuleNumber, groupLabels, type AttemptChoice, type Run } from '../shared/contracts';

export function AttemptTrail({ run, openRule }: { run: Run; openRule?: (number: number) => void }) {
  const attempt = run.attempt;
  if (!attempt) return null;
  const describe = ({ checkId, checks }: AttemptChoice) => {
    const check = run.checks.find(({ id }) => id === checkId);
    return `GET ${check?.path} · ${checks.map(({ id, expectedCities }) => {
      const label = run.checks.find((check) => check.id === id)?.label;
      return `${label} — ${expectedCities.map((group) => groupLabels[group]).join(', ') || 'пусто'}`;
    }).join('; ')}`;
  };
  const help = { none: 'Без подсказки до запуска', 'before-choice': 'Buddy до фиксации первого варианта',
    'after-choice': 'Buddy после самостоятельного выбора' }[attempt.help];
  const changed = attempt.first && JSON.stringify(attempt.first) !== JSON.stringify(attempt.final);
  const rule = checkRuleNumber(attempt.final.checkId);
  return (
    <section className="attempt-evidence" aria-label="Ход попытки">
      <h3>Ход попытки</h3>
      <p className="fact">{help}</p>
      <dl>
        <dt>Первый вариант</dt><dd>{attempt.first ? describe(attempt.first) : 'Первый сохранённый вариант зафиксирован при запуске.'}</dd>
        <dt>Подтверждённый вариант</dt><dd>{describe(attempt.final)}</dd>
      </dl>
      {changed && <p><strong>Выбор изменился.</strong> {openRule
        ? <button type="button" className="text-link" onClick={() => openRule(rule)}>Сверить с пунктом {rule}</button>
        : `Сверь с пунктом ${rule}. ${run.task.instruction.rules[rule - 1]}`}</p>}
    </section>
  );
}
