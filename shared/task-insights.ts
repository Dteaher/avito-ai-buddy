import { checkRuleNumber, type AttemptChoice, type CatalogCheck, type Task, type TaskParticipant, type TaskVersion } from './contracts.ts';

export interface TaskInsight {
  section: 'criterion' | 'checks';
  checkId: CatalogCheck['id'];
  text: string;
}

export function wrongExpectation(check: CatalogCheck, choice?: AttemptChoice) {
  const expected = choice?.checks.find(({ id }) => id === check.id);
  return Boolean(expected && (expected.expectedCities.length !== check.required.length
    || check.required.some((group) => !expected.expectedCities.includes(group))
    || (check.uniqueIds && expected.expectedUniqueIds !== true)));
}

function matchesInsight(insight: Pick<TaskInsight, 'section' | 'checkId'>, check: CatalogCheck, participant?: TaskParticipant) {
  return insight.section === 'criterion' ? wrongExpectation(check, participant?.firstChoice)
    : participant?.firstChoice?.checkId === insight.checkId;
}

export function taskInsights(task: Task, participants: TaskParticipant[]): TaskInsight[] {
  const checks = task.comparison?.checks ?? [];
  const insights: TaskInsight[] = [];
  for (const check of checks) {
    const sectionNames = checks.length > 1 ? ['criterion', 'checks'] as const : ['criterion'] as const;
    for (const section of sectionNames) {
      const signal = { section, checkId: check.id };
      const count = participants.filter((participant) => participant.clarification?.section === section
        && matchesInsight(signal, check, participant)).length;
      if (count < 2) continue;
      const people = count === 2 ? '2 стажёра' : `${count} участников`;
      const text = section === 'criterion'
        ? `${people} спросили о критерии и сохранили ожидание, которое расходилось с пунктом ${checkRuleNumber(check.id, task)} («${check.label}»).`
        : `${people} спросили о выборе запроса и первоначально выбрали «${check.label}».`;
      insights.push({ ...signal, text });
    }
  }
  return insights;
}

export function compareInsight(insight: TaskInsight, previous: TaskVersion, latest: TaskVersion) {
  const before = previous.task.comparison?.checks.find(({ id }) => id === insight.checkId);
  const after = latest.task.comparison?.checks.find(({ id }) => id === insight.checkId);
  if (!before || !after) return;
  const paired = previous.participants
    .filter((participant) => participant.clarification?.section === insight.section && matchesInsight(insight, before, participant))
    .flatMap(({ traineeId }) => latest.participants.find((participant) => participant.traineeId === traineeId && participant.firstChoice) ?? []);
  if (paired.length < 2) return;
  const repeated = paired.filter((participant) => matchesInsight(insight, after, participant)).length;
  return { total: paired.length, repeated };
}
