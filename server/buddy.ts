import type { BuddyAnswer, Workspace } from '../shared/contracts.ts';
import { isObject, task } from './scenario.ts';

const sourceId = task.instruction.id;

function answerFromGuide(question: string): BuddyAnswer {
  const query = question.toLowerCase().replaceAll('ё', 'е');
  const status = /\b200\b|статус (?:ответа|запроса)|код ответа/.test(query);
  const noCity = /без (?:выбора |фильтра |указания )?город|без фильтра|город.{0,16}(?:не (?:выбран|задан|указан)|пуст)/.test(query);
  const kazan = /city=kazan|контрольн|с фильтром|указан город/.test(query)
    || (/казан|kazan/.test(query) && /поиск|фильтр|выдач|город|запрос|ответ|вернет/.test(query));

  if (status || noCity || kazan) {
    const rules = task.instruction.rules;
    const lines = [];
    if (status) lines.push(rules[2]);
    if (noCity || (status && !kazan)) lines.push(rules[0]);
    if (kazan) lines.push(rules[1]);
    return { text: lines.join('\n\n'), sourceId };
  }

  return { text: 'Уточни, что разбираем в SEARCH-01 — выдачу без города, фильтр по Казани или значение HTTP 200?' };
}

export function createBuddy(env: NodeJS.ProcessEnv) {
  const base = env.BUDDY_BASE_URL?.trim();
  const model = env.BUDDY_MODEL?.trim();
  const key = env.BUDDY_API_KEY?.trim();
  const mode: Workspace['buddyMode'] = base && model && key ? 'model' : 'guide';

  return {
    mode,
    async answer(question: string): Promise<BuddyAnswer> {
      if (mode === 'guide') return answerFromGuide(question);

      const response = await fetch(`${base!.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        redirect: 'error',
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: [
              'Ты Buddy, наставник backend-стажёра. Отвечай кратко по-русски, опираясь на тестовую инструкцию ниже.',
              'Если вопрос неоднозначен, попроси уточнить запрос или поведение. Если сведений не хватает, скажи об этом.',
              'Не обещай запуск проверок и публикацию. Эти действия стажёр подтверждает сам в интерфейсе. Отвечай обычным текстом.',
              `Задача ${task.id}. ${task.title}. ${task.criterion}`,
              ...task.instruction.rules,
            ].join('\n') },
            { role: 'user', content: question },
          ],
        }),
      });

      if (!response.ok) throw new Error('Buddy provider unavailable');
      const data: unknown = await response.json();
      const first: unknown = isObject(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
      const message = isObject(first) ? first.message : undefined;
      const content = isObject(message) ? message.content : undefined;
      if (typeof content !== 'string' || !content.trim()) throw new Error('Invalid Buddy response');
      return { text: content.trim().slice(0, 2500), sourceId };
    },
  };
}
