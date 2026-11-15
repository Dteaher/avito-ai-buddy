import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import type { DemoIdentity, Preparation, Workspace } from '../shared/contracts.ts';
import { parseBuddyQuestion, type createBuddy } from './buddy.ts';
import { checks, executeRun, isObject, listings, parseChecks, task } from './scenario.ts';
import { executePriceRun, parsePriceCheck, priceCheck, priceItems, sortTask } from './price-scenario.ts';
import type { createStore } from './store.ts';
import { assignedTrainee, findIdentity, identities } from './demo-identities.ts';

const assignedTasks = [task, sortTask];

interface AppOptions {
  store: ReturnType<typeof createStore>;
  standOrigin: () => string;
  buddy: ReturnType<typeof createBuddy>;
  staticDir?: string;
}

export function createApp({ store, standOrigin, buddy, staticDir }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  const cookieName = 'buddy_session';
  let standFixed = false;
  const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
  const tokenFrom = (req: Request) => req.headers.cookie?.match(/(?:^|;\s*)buddy_session=([0-9a-f]{48})(?:;|$)/)?.[1];
  const identityFrom = (req: Request) => {
    const token = tokenFrom(req);
    return token ? findIdentity(store.readSession(token)) : undefined;
  };
  function setSession(res: express.Response, identity: DemoIdentity, previous?: string) {
    const token = randomBytes(24).toString('hex');
    store.issueSession(token, identity.id, Date.now() + sessionLifetime, previous);
    res.cookie(cookieName, token, { httpOnly: true, sameSite: 'strict', path: '/api', maxAge: sessionLifetime });
  }

  app.use((req, res, next) => {
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.get('host') ?? '')) {
      res.status(403).json({ message: 'Откройте приложение на localhost.' });
      return;
    }
    const origin = req.get('origin');
    if (req.method === 'POST' && origin && origin !== `http://${req.get('host')}`) {
      res.status(403).json({ message: 'Запрос из другого источника отклонён.' });
      return;
    }
    next();
  });

  app.get('/demo/search', (req, res) => {
    const filters = Object.keys(req.query);
    res.set('X-Avito-Demo-Stand', standFixed ? 'fixed' : 'defect');
    res.set('Cache-Control', 'no-store');
    if (filters.length === 1 && req.query.sort === 'price_asc') {
      // Намеренный дефект: null идёт первым, хотя состав выдачи полный.
      const nullPrice = standFixed ? Infinity : -Infinity;
      const items = priceItems.toSorted((a, b) => (a.price ?? nullPrice) - (b.price ?? nullPrice));
      res.json({ items });
      return;
    }
    if (filters.length && !(filters.length === 1 && req.query.city === 'kazan')) {
      res.status(400).json({ message: 'Разрешены запрос без параметров, city=kazan и sort=price_asc.' });
      return;
    }
    // В запросе без фильтра стенд намеренно теряет объявление из Самары.
    res.json({ items: standFixed && !filters.length ? listings : listings.filter(({ city }) => city === 'kazan') });
  });

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/workspace', (req, res) => {
    const selected = req.query.task ?? task.id;
    if (!assignedTasks.some(({ id }) => id === selected)) {
      res.status(404).json({ message: 'Задача недоступна в этой сессии.' });
      return;
    }
    const existing = identityFrom(req);
    const identity = existing ?? identities[0];
    if (!existing) setSession(res, identity);
    const context = { tasks: assignedTasks, identity, standFixed, buddyMode: buddy.mode, buddyProvider: buddy.provider };
    const workspace: Workspace = selected === sortTask.id
      ? { ...context, kind: 'price-order', task: sortTask, checks: [priceCheck], orderItems: priceItems }
      : { ...context, task, checks: [...checks] };
    res.json(workspace);
  });

  app.use('/api', express.json({ limit: '8kb' }));
  app.post('/api/session', (req, res) => {
    const identity = findIdentity(req.body?.identity);
    if (!identity) {
      res.status(400).json({ message: 'Выбери тестовую роль.' });
      return;
    }
    setSession(res, identity, tokenFrom(req));
    res.json(identity);
  });

  app.use('/api', (req, res, next) => {
    const identity = identityFrom(req);
    if (!identity) {
      res.status(401).json({ message: 'Демо-сессия истекла. Обнови страницу.' });
      return;
    }
    res.locals.identity = identity;
    next();
  });

  const assignedTask: RequestHandler = (req, res, next) => {
    if (res.locals.identity.role !== 'trainee' || !assignedTasks.some(({ id }) => id === req.params.taskId)) {
      res.status(404).json({ message: 'Задача недоступна в этой сессии.' });
      return;
    }
    next();
  };

  app.post('/api/demo/stand', (req, res) => {
    if (res.locals.identity.role !== 'mentor') {
      res.status(403).json({ message: 'Режим демо-стенда меняет наставник.' });
      return;
    }
    if (typeof req.body?.fixed !== 'boolean') {
      res.status(400).json({ message: 'Выбери состояние тестового стенда.' });
      return;
    }
    standFixed = req.body.fixed;
    res.json({ fixed: standFixed });
  });

  app.post('/api/tasks/:taskId/buddy', assignedTask, async (req, res) => {
    const input = parseBuddyQuestion(req.body);
    if (!input) {
      res.status(400).json({ message: 'Проверь вопрос и попробуй ещё раз. Максимум 500 символов.' });
      return;
    }
    const current = req.params.taskId === sortTask.id ? sortTask : task;
    const owner: DemoIdentity['id'] = res.locals.identity.id;
    const run = input.runId ? store.readRun(input.runId, owner, current.id) : undefined;
    if (input.runId && !run) {
      res.status(404).json({ message: 'Прогон недоступен в этой задаче.' });
      return;
    }
    const requestLifetime = new AbortController();
    res.once('close', () => requestLifetime.abort());
    try {
      const answer = await buddy.answer(current, input, run, requestLifetime.signal, owner);
      if (!requestLifetime.signal.aborted) res.json(answer);
    } catch (error) {
      if (!requestLifetime.signal.aborted) throw error;
    }
  });

  app.get('/api/tasks/:taskId/runs/:runId', assignedTask, (req, res) => {
    const run = store.readRun(String(req.params.runId), res.locals.identity.id, String(req.params.taskId));
    if (!run) {
      res.status(404).json({ message: 'Прогон недоступен в этой задаче.' });
      return;
    }
    res.json(run);
  });

  app.post('/api/tasks/:taskId/runs', assignedTask, async (req, res) => {
    const priceTask = req.params.taskId === sortTask.id;
    const { preparation, ...input } = isObject(req.body) ? req.body : {};
    const order = priceTask ? parsePriceCheck(input) : undefined;
    const cities = priceTask ? undefined : parseChecks(input);
    const question = isObject(preparation) && typeof preparation.question === 'string' ? preparation.question.trim() : '';
    const checkId = isObject(preparation) && preparation.checkId;
    const hasPreparation = isObject(preparation) && preparation.source === 'buddy-draft' && question.length > 0 && question.length <= 500
      && (priceTask ? checkId === priceCheck.id : checks.some(({ id }) => id === checkId));
    if ((!order && !cities) || (preparation !== undefined && !hasPreparation)) {
      res.status(400).json({ message: priceTask
        ? 'Задай ожидаемый порядок всех трёх объявлений.'
        : 'Выбери ожидаемые города для обоих разрешённых запросов.' });
      return;
    }
    let run;
    try {
      run = order ? await executePriceRun(standOrigin(), order) : await executeRun(standOrigin(), cities!);
    } catch {
      res.status(502).json({ message: 'Стенд не ответил как ожидалось. Повтори запуск, ожидание сохранено.' });
      return;
    }
    if (hasPreparation) run.preparation = { question, checkId: checkId as Preparation['checkId'], source: 'buddy-draft' };
    store.saveRun(run, res.locals.identity.id);
    res.status(201).json(run);
  });

  app.post('/api/tasks/:taskId/runs/:runId/publication', assignedTask, (req, res) => {
    const conclusion = req.body?.conclusion ?? '';
    if (typeof conclusion !== 'string' || conclusion.length > 1000) {
      res.status(400).json({ message: 'Вывод должен содержать не более 1000 символов.' });
      return;
    }
    const { record, created } = store.publish(String(req.params.runId), res.locals.identity.id, String(req.params.taskId), conclusion.trim());
    if (!record) {
      res.status(404).json({ message: 'Прогон недоступен в этой сессии.' });
      return;
    }
    res.status(created ? 201 : 200).json(record);
  });

  app.get('/api/records', (_req, res) => {
    res.json(store.recordsFor(assignedTrainee(res.locals.identity.id)));
  });

  app.get('/api/records/:id', (req, res) => {
    const record = store.readRecord(req.params.id, assignedTrainee(res.locals.identity.id));
    if (!record || !assignedTasks.some(({ id }) => id === record.run.task.id)) {
      res.status(404).json({ message: 'Запись не найдена. Проверь ссылку или открой рабочее пространство.' });
      return;
    }
    res.json({ ...record, ...store.readReplay(record.id, assignedTrainee(res.locals.identity.id)) });
  });

  app.post('/api/records/:id/revisions', (req, res) => {
    const identity: DemoIdentity = res.locals.identity;
    const previous = identity.role === 'trainee' ? store.readRecord(req.params.id, identity.id) : undefined;
    if (!previous) {
      res.status(404).json({ message: 'Запись недоступна для исправления.' });
      return;
    }
    const { conclusion, runId = previous.run.id } = req.body ?? {};
    if (typeof conclusion !== 'string' || conclusion.length > 1000 || typeof runId !== 'string'
      || (!conclusion.trim() && runId === previous.run.id)) {
      res.status(400).json({ message: 'Укажи исправленный вывод до 1000 символов.' });
      return;
    }
    if (previous.review?.decision !== 'returned' || (runId === previous.run.id && conclusion.trim() === (previous.conclusion ?? ''))) {
      res.status(409).json({ message: 'Для новой версии нужна возвращённая запись и изменение вывода или прогона.' });
      return;
    }
    if (!store.readRun(runId, identity.id, previous.run.task.id)) {
      res.status(404).json({ message: 'Прогон недоступен в этой задаче.' });
      return;
    }
    const { record, created } = store.revise(previous, identity.id, runId, conclusion.trim());
    if (!record) {
      res.status(409).json({ message: 'Версия или публикация уже существует. Обнови запись.' });
      return;
    }
    res.status(created ? 201 : 200).json(record);
  });

  app.post('/api/records/:id/replay', async (req, res) => {
    const identity: DemoIdentity = res.locals.identity;
    const owner = assignedTrainee(identity.id);
    const record = store.readRecord(req.params.id, owner);
    if (!record) {
      res.status(404).json({ message: 'Запись недоступна для повторной проверки.' });
      return;
    }
    const original = record.run;
    const order = original.kind === 'price-order' && original.checks[0].path === priceCheck.path
      ? parsePriceCheck({ checks: original.checks.map(({ id, expectedOrder }) => ({ id, expectedOrder })) }) : undefined;
    const cities = original.kind !== 'price-order' && original.checks.every(({ id, path }) => checks.some((check) => check.id === id && check.path === path))
      ? parseChecks({ checks: original.checks.map(({ id, expectedCities }) => ({ id, expectedCities })) }) : undefined;
    if (!order && !cities) {
      res.status(409).json({ message: 'Каталог изменился. Подготовь новый запрос по текущей инструкции.' });
      return;
    }
    let replay;
    try {
      replay = order ? await executePriceRun(standOrigin(), order) : await executeRun(standOrigin(), cities!);
    } catch {
      res.status(502).json({ message: 'Стенд недоступен для повтора. Исходная запись сохранена.' });
      return;
    }
    replay.preparation = original.preparation;
    store.saveReplay(record.id, replay, owner, identity.id);
    res.status(201).json(replay);
  });

  app.post('/api/records/:id/review', (req, res) => {
    const identity: DemoIdentity = res.locals.identity;
    if (identity.role !== 'mentor') {
      res.status(403).json({ message: 'Решение может оставить назначенный наставник.' });
      return;
    }
    const { decision, comment = '' } = req.body ?? {};
    if ((decision !== 'accepted' && decision !== 'returned') || typeof comment !== 'string'
      || comment.length > 1000 || (decision === 'returned' && !comment.trim())) {
      res.status(400).json({ message: 'Для возврата оставь комментарий до 1000 символов.' });
      return;
    }
    const { record, created } = store.reviewRecord(req.params.id, assignedTrainee(identity.id), decision, comment.trim());
    if (!record) {
      res.status(404).json({ message: 'Запись недоступна.' });
      return;
    }
    if (!created) {
      res.status(409).json({ message: 'Решение уже сохранено. Обнови запись.' });
      return;
    }
    res.json(record);
  });

  app.use(['/api', '/demo'], (_req, res) => res.status(404).json({ message: 'Маршрут не найден.' }));

  if (staticDir) {
    app.use(express.static(staticDir));
    app.get(['/', '/records/:id'], (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }

  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.status === 400 || error.status === 413) {
      res.status(error.status).json({ message: 'Запрос слишком большой или содержит некорректный JSON.' });
      return;
    }
    console.error('Ошибка приложения', error);
    res.status(500).json({ message: 'Сервис временно недоступен. Попробуй ещё раз.' });
  };
  app.use(onError);
  return app;
}
