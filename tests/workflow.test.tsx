// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { checks, listings, task } from '../server/scenario.ts';
import type { CheckResult, Publication, Run, Workspace } from '../shared/contracts.ts';

const workspace: Workspace = { task, checks: [...checks], buddyMode: 'guide' };
const response = { status: 200, items: [listings[0]], rawBody: '{"items":[{"city":"kazan"}]}' };
const run: Run = {
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

function api(options: { retryRun?: boolean; retryPublish?: boolean; retryBuddy?: boolean; result?: Run } = {}) {
  let runs = 0;
  let publications = 0;
  let questions = 0;
  const mock = vi.fn(async (url: string) => {
    if (url === '/api/workspace') return Response.json(workspace);
    if (url.endsWith('/buddy')) {
      if (++questions === 1 && options.retryBuddy) throw new Error('Network error');
      return Response.json({ text: 'Проверь содержимое ответа.', sourceId: task.instruction.id });
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
  it('links the source, compares both responses and publishes after confirmation', async () => {
    const mock = api();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Ответа 200 достаточно?' }));
    await screen.findByText('Проверь содержимое ответа.');
    const buddy = screen.getByRole('complementary', { name: 'AI-buddy' });
    expect(within(buddy).getByRole('button', { name: 'Тестовая инструкция' })).toBeTruthy();
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
    api();
    window.history.replaceState(null, '', '/records/QA-demo');
    render(<App />);
    await screen.findByRole('heading', { name: 'Запись проверки' });
    expect(screen.getByText('QA-demo')).toBeTruthy();
    expect(screen.getByText('Самара отсутствует')).toBeTruthy();
    expect(screen.getByRole('link', { name: /К рабочему пространству/ }).getAttribute('href')).toBe('/');
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
});
