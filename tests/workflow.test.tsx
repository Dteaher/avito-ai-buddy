// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { checks, listings, task } from '../server/scenario.ts';
import { priceCheck, priceItems, sortTask } from '../server/price-scenario.ts';
import type { BuddyAnswer, BuddyQuestion, CheckResult, CityRun, Publication, Run, Workspace } from '../shared/contracts.ts';

const workspace: Workspace = { task, tasks: [task], checks: [...checks], buddyMode: 'guide' };
const response = { status: 200, items: [listings[0]], rawBody: '{"items":[{"city":"kazan"}]}' };
const run: CityRun = {
  id: 'run-1', task, checkedAt: '2026-11-12T10:00:00.000Z',
  checks: [
    { ...checks[0], ...response, actualCities: ['kazan'], expectedCities: ['kazan', 'samara'], ruleCities: ['kazan', 'samara'], missing: ['samara'], extra: [], matches: false, followsRule: true },
    { ...checks[1], ...response, actualCities: ['kazan'], expectedCities: ['kazan'], ruleCities: ['kazan'], missing: [], extra: [], matches: true, followsRule: true },
  ],
};
const publication: Publication = { id: 'QA-demo', url: '/records/QA-demo', run, publishedAt: '2026-11-12T10:01:00.000Z' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const guidance: BuddyAnswer = {
  kind: 'guidance', text: 'Проверь содержимое ответа.', mode: 'guide', sources: [{ instructionId: task.instruction.id, ruleNumber: 3 }],
};

function api(options: { retryRun?: boolean; retryPublish?: boolean; retryBuddy?: boolean; result?: Run; answers?: BuddyAnswer[]; workspace?: Workspace } = {}) {
  let runs = 0;
  let publications = 0;
  let questions = 0;
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url.startsWith('/api/workspace')) return Response.json(options.workspace ?? workspace);
    if (url.endsWith('/buddy')) {
      if (++questions === 1 && options.retryBuddy) throw new Error('Network error');
      return Response.json(options.answers?.[questions - 1] ?? guidance);
    }
    if (url.endsWith('/runs')) {
      if (++runs === 1 && options.retryRun) return Response.json({ message: 'Сбой стенда' }, { status: 502 });
      return Response.json(options.result ?? run);
    }
    if (url.endsWith('/publication')) {
      if (++publications === 1 && options.retryPublish) return Response.json({ message: 'Сбой трекера' }, { status: 500 });
      return Response.json(publication);
    }
    if (url === '/api/records/QA-demo') return Response.json(publication);
    return Response.json({ message: 'Запись не найдена' }, { status: 404 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function prepare(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Подготовить проверку' }));
  const primary = screen.getByRole('group', { name: /Основной запрос/ });
  const control = screen.getByRole('group', { name: /Контрольный запрос/ });
  const launch = screen.getByRole('button', { name: 'Запустить проверку' }) as HTMLButtonElement;
  expect(launch.disabled).toBe(true);
  await user.click(within(primary).getByRole('button', { name: 'Казань' }));
  await user.click(within(primary).getByRole('button', { name: 'Самара' }));
  await user.click(within(control).getByRole('button', { name: 'Казань' }));
  return launch;
}

describe('First Check workspace', () => {
  it('captures a learner-defined price order and explains which item moved', async () => {
    window.history.replaceState(null, '', '/?task=SORT-01');
    const expectedOrder = ['ad-201', 'ad-202', 'ad-203'];
    const items = [priceItems[1], priceItems[2], priceItems[0]];
    const mock = api({
      workspace: { kind: 'price-order', task: sortTask, tasks: [task, sortTask], checks: [priceCheck], orderItems: priceItems, buddyMode: 'guide' },
      result: { kind: 'price-order', id: 'sort-1', task: sortTask, checkedAt: run.checkedAt, checks: [{
        ...priceCheck, expectedOrder, actualOrder: items.map(({ id }) => id), ruleOrder: expectedOrder, fixtures: priceItems,
        items, rawBody: JSON.stringify({ items }), status: 200, sameItems: true, matches: false, followsRule: true,
      }] },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Подготовить проверку' }));
    const launch = screen.getByRole<HTMLButtonElement>('button', { name: 'Запустить проверку' });
    expect(launch.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /500 ₽/ }));
    await user.click(screen.getByRole('button', { name: /Без цены/ }));
    await user.click(screen.getByRole('button', { name: 'Отменить последний выбор' }));
    await user.click(screen.getByRole('button', { name: /900 ₽/ }));
    await user.click(screen.getByRole('button', { name: /Без цены/ }));
    await user.click(launch);
    await screen.findByText('Состав совпал. Порядок отличается.');
    expect(screen.getByText(/на 1-м месте вместо 3-го/)).toBeTruthy();
    const sent = mock.mock.calls.find(([url]) => url === '/api/tasks/SORT-01/runs');
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ checks: [{ id: 'price-asc', expectedOrder }] });
    expect(mock.mock.calls.some(([url]) => url.endsWith('/buddy'))).toBe(false);
  });
  it('links the source, compares both responses and publishes after confirmation', async () => {
    const mock = api();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Ответа 200 достаточно?' }));
    await screen.findByText('Проверь содержимое ответа.');
    const buddy = screen.getByRole('complementary', { name: 'AI-buddy' });
    expect(within(buddy).getByRole('button', { name: 'Тестовая инструкция · пункт 3' })).toBeTruthy();
    const launch = await prepare(user);
    await user.click(launch);
    await screen.findByText('Самара отсутствует');
    expect(screen.getByText('Совпало', { selector: '.verdict-chip' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Опубликовать в задачу' }));
    expect(mock.mock.calls.some(([url]) => url.endsWith('/publication'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Подтвердить публикацию' }));
    const link = await screen.findByRole('link', { name: 'Открыть запись QA-demo' });
    expect(link.getAttribute('href')).toBe('/records/QA-demo');
  });

  it('allows retrying a failed run and publication with the original inputs', async () => {
    const mock = api({ retryRun: true, retryPublish: true });
    const user = userEvent.setup();
    render(<App />);
    const launch = await prepare(user);
    await user.click(launch);
    expect((await screen.findByRole('alert')).textContent).toContain('Сбой стенда');
    expect(screen.getByRole('button', { name: 'Самара', pressed: true })).toBeTruthy();
    await user.click(launch);
    await user.click(await screen.findByRole('button', { name: 'Опубликовать в задачу' }));
    const confirm = screen.getByRole('button', { name: 'Подтвердить публикацию' });
    await user.click(confirm);
    await screen.findByText('Сбой трекера');
    await user.click(confirm);
    await screen.findByRole('link', { name: 'Открыть запись QA-demo' });
    expect(mock.mock.calls.filter(([url]) => url.endsWith('/runs'))).toHaveLength(2);
    expect(mock.mock.calls.filter(([url]) => url.endsWith('/run-1/publication'))).toHaveLength(2);
  });

  it('loads a durable record from its direct URL', async () => {
    const mock = api();
    window.history.replaceState(null, '', '/records/QA-demo');
    render(<App />);
    await screen.findByRole('heading', { name: 'Запись проверки' });
    expect(screen.getByText('QA-demo')).toBeTruthy();
    expect(screen.getByText('Самара отсутствует')).toBeTruthy();
    expect(screen.getByRole('link', { name: /К рабочему пространству/ }).getAttribute('href')).toBe('/');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Разобрать результат' }));
    await screen.findByText('Проверь содержимое ответа.');
    const discussion = mock.mock.calls.find(([url]) => url.endsWith('/SEARCH-01/buddy'));
    expect(JSON.parse(String(discussion?.[1]?.body))).toEqual({ question: 'Что вернул каждый из двух запросов в моём прогоне и где расхождение?', runId: run.id });
  });

  it('separates a matching response from an expectation that conflicts with the rule', async () => {
    const primary: CheckResult = { ...run.checks[0], expectedCities: ['kazan'], matches: true, followsRule: false, missing: [] };
    api({ result: { ...run, checks: [primary, run.checks[1]] } });
    const user = userEvent.setup();
    render(<App />);
    const launch = await prepare(user);
    await user.click(screen.getByRole('button', { name: 'Самара', pressed: true }));
    await user.click(launch);
    expect(await screen.findByText(/По тестовой инструкции ожидаем Казань и Самара/)).toBeTruthy();
    const result = screen.getByRole('region', { name: 'Основной запрос' });
    expect(within(result).getByText('Совпало')).toBeTruthy();
    expect(within(result).queryByText('Самара отсутствует')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Изменить ожидания' }));
    await user.click(within(screen.getByRole('group', { name: 'Основной запрос' })).getByRole('button', { name: 'Пустая выдача' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Проверить' }).disabled).toBe(true);
  });

  it('retries a typed Buddy question after a connection failure', async () => {
    api({ retryBuddy: true });
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole('textbox', { name: 'Спросить Buddy' });
    await user.type(input, 'Ответа 200 достаточно?{Enter}');
    const failure = await screen.findByRole('alert');
    expect(failure.textContent).toContain('Нет связи с сервером');
    await user.click(within(failure).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Проверь содержимое ответа.')).toBeTruthy();
    expect(screen.getAllByText('Ответа 200 достаточно?')).toHaveLength(1);
  });

  it('keeps task preparation and execution available while the model is replying', async () => {
    const mock = api();
    const implementation = mock.getMockImplementation()!;
    let finishReply!: (response: Response) => void;
    mock.mockImplementation((url, options) => url.endsWith('/buddy')
      ? new Promise<Response>((resolve) => { finishReply = resolve; }) : implementation(url, options));
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole('textbox', { name: 'Спросить Buddy' });
    await user.type(input, 'Как проверить город?{Enter}');
    expect((await screen.findByRole('status')).textContent).toContain('Buddy отвечает');
    const launch = await prepare(user);
    await user.type(input, 'Уточню после ответа');
    expect((input as HTMLTextAreaElement).value).toBe('Уточню после ответа');
    await user.click(launch);
    await screen.findByText('Самара отсутствует');
    expect(screen.getByRole('status').textContent).toContain('Buddy отвечает');
    finishReply(Response.json(guidance));
    await screen.findByText(guidance.text);
    expect(screen.queryByRole('status')).toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe('Уточню после ответа');
  });

  it('asks about the current run and continues the model conversation', async () => {
    const mock = api({ answers: [
      { kind: 'guidance', text: 'Самара отсутствует в основном запросе.', mode: 'model', conversationId: 'conversation-1',
        sources: [{ runId: run.id, checkId: 'without-city', label: 'Без города' }] },
      { kind: 'guidance', text: 'Контрольный запрос вернул Казань.', mode: 'model', conversationId: 'conversation-1',
        sources: [{ runId: run.id, checkId: 'kazan', label: 'Фильтр по Казани' }] },
    ] });
    const user = userEvent.setup();
    render(<App />);
    const launch = await prepare(user);
    await user.click(launch);
    await user.click(await screen.findByRole('button', { name: 'Разобрать результат' }));
    const buddy = screen.getByRole('complementary', { name: 'AI-buddy' });
    await within(buddy).findByRole('button', { name: 'Ответ стенда · Без города' });
    await user.type(within(buddy).getByRole('textbox', { name: 'Спросить Buddy' }), 'А контрольный?{Enter}');
    await within(buddy).findByRole('button', { name: 'Ответ стенда · Фильтр по Казани' });
    expect(mock.mock.calls.filter(([url]) => url.endsWith('/buddy')).map(([, options]) => JSON.parse(String(options?.body)))).toEqual([
      { question: 'Что вернул каждый из двух запросов в моём прогоне и где расхождение?', runId: run.id },
      { question: 'А контрольный?', runId: run.id, conversationId: 'conversation-1' },
    ]);
  });

  it('replies to a clarification and visibly labels the instruction fallback', async () => {
    const mock = api({ answers: [
      { kind: 'clarification', text: 'Был ли задан фильтр по городу?', mode: 'model', sources: [], clarificationId: 'issued-id' },
      { ...guidance, mode: 'guide-fallback', sources: [{ instructionId: task.instruction.id, ruleNumber: 1 }] },
      { kind: 'insufficient', text: 'В тестовой инструкции сведений об этом нет.', mode: 'guide-fallback', sources: [] },
    ] });
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole('textbox', { name: 'Спросить Buddy' });
    await user.type(input, 'В выдаче один город?{Enter}');
    const buddy = screen.getByRole('complementary', { name: 'AI-buddy' });
    await within(buddy).findByText('Был ли задан фильтр по городу?');
    expect(within(buddy).queryByRole('button', { name: /пункт/ })).toBeNull();

    await user.type(input, 'Нет{Enter}');
    await within(buddy).findByText('Модель недоступна. Ответ из демо-справки.');
    expect(within(buddy).getByRole('button', { name: 'Тестовая инструкция · пункт 1' })).toBeTruthy();
    await user.type(input, 'Как получить доступ к продакшену?{Enter}');
    await within(buddy).findByRole('button', { name: 'Открыть тестовую инструкцию' });
    const questions = mock.mock.calls.filter(([url]) => url.endsWith('/buddy'))
      .map(([, init]) => JSON.parse(String(init?.body)) as BuddyQuestion);
    expect(questions).toEqual([
      { question: 'В выдаче один город?' }, { question: 'Нет', clarificationId: 'issued-id' }, { question: 'Как получить доступ к продакшену?' },
    ]);
  });
});
