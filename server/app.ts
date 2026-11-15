import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import type { AttemptChoice, CheckInput, DemoIdentity, Preparation, Task, Workspace } from '../shared/contracts.ts';
import { parseBuddyQuestion, type createBuddy } from './buddy.ts';
import { executeRun, isObject, listings, parseChecks, setPlan, task } from './scenario.ts';
import { executePriceRun, parsePriceCheck, priceCheck, priceItems, sortTask } from './price-scenario.ts';
import type { createStore } from './store.ts';
import { assignedTrainee, findIdentity, identities } from './demo-identities.ts';
import { archiveTask, products } from './archive-scenario.ts';

const demoTasks = [task, sortTask];

function attemptChoice(checks: CheckInput[], id: unknown): AttemptChoice | undefined {
  const selected = checks.find((check) => check.id === id);
  if (selected) return { checkId: selected.id, expected: selected.expectedCities, checks };
}

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
  const inventoryHeaders = { 'X-Demo-Inventory-Key': randomBytes(24).toString('hex') };
  const taskFor = (id: unknown, owner: DemoIdentity['id']) => demoTasks.find((candidate) => candidate.id === id)
    ?? (id === archiveTask.id ? store.assignment(archiveTask.id, owner) : undefined);
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

  app.get('/demo/inventory', (req, res) => {
    if (req.get('X-Demo-Inventory-Key') !== inventoryHeaders['X-Demo-Inventory-Key']) {
      res.sendStatus(404);
      return;
    }
    const filters = Object.keys(req.query);
    if (filters.length && !(filters.length === 1 && req.query.status === 'active')) {
      res.status(400).json({ message: 'Поддерживается status=active.' });
      return;
    }
    res.set('X-Avito-Demo-Stand', standFixed ? 'fixed' : 'defect');
    res.set('Cache-Control', 'no-store');
    res.json({ items: standFixed && !filters.length ? products : products.filter(({ status }) => status === 'active') });
  });

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/workspace', (req, res) => {
    const selected = req.query.task ?? task.id;
    const existing = identityFrom(req);
    const identity = existing ?? identities[0];
    const current = taskFor(selected, identity.id);
    if (!current) {
      res.status(404).json({ message: 'Задача недоступна в этой сессии.' });
      return;
    }
    if (!existing) setSession(res, identity);
    const assigned = store.assignment(archiveTask.id, identity.id);
    const tasks = assigned ? [...demoTasks, assigned] : demoTasks;
    const context = { tasks, identity, standFixed, buddyMode: buddy.mode, buddyProvider: buddy.provider,
      assignmentOffer: identity.role === 'mentor' ? { id: archiveTask.id, title: archiveTask.title,
        version: archiveTask.instruction.version, assigned: Boolean(store.assignment(archiveTask.id, assignedTrainee(identity.id))) } : undefined };
    const workspace: Workspace = selected === sortTask.id
      ? { ...context, kind: 'price-order', task: sortTask, checks: [priceCheck], orderItems: priceItems }
      : { ...context, task: current, checks: setPlan(current).checks.map(({ id, label, path, parameter }) => ({ id, label, path, parameter })),
        attemptId: current.comparison ? store.openAttempt(current.id, identity.id) : undefined };
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
    const current = res.locals.identity.role === 'trainee' ? taskFor(req.params.taskId, res.locals.identity.id) : undefined;
    if (!current) {
      res.status(404).json({ message: 'Задача недоступна в этой сессии.' });
      return;
    }
    res.locals.task = current;
    next();
  };

  app.post('/api/assignments', (req, res) => {
    const mentor: DemoIdentity = res.locals.identity;
    if (mentor.role !== 'mentor') {
      res.status(403).json({ message: 'Поручение назначает наставник.' });
      return;
    }
    const traineeId = assignedTrainee(mentor.id);
    if (req.body?.templateId !== archiveTask.id || req.body?.traineeId !== traineeId) {
      res.status(400).json({ message: 'Выбери поручение и своего стажёра.' });
      return;
    }
    const created = store.assign(archiveTask, traineeId, mentor.id);
    res.status(created ? 201 : 200).json({ task: store.assignment(archiveTask.id, traineeId), traineeId });
  });

  app.get('/api/tasks/:taskId/instruction', assignedTask, (_req, res) => {
    res.json(res.locals.task.instruction);
  });

  app.post('/api/tasks/:taskId/attempt', assignedTask, (req, res) => {
    const current: Task = res.locals.task;
    const { attemptId, checkId, checks } = req.body ?? {};
    const input = current.comparison ? parseChecks({ checks }, current) : undefined;
    const choice = input && attemptChoice(input, checkId);
    if (typeof attemptId !== 'string' || !choice) {
      res.status(400).json({ message: 'Выбери запрос и отметь ожидаемые группы для обеих проверок.' });
      return;
    }
    if (!store.setFirstChoice(attemptId, current.id, res.locals.identity.id, choice)) {
      res.status(409).json({ message: 'Первоначальный выбор уже зафиксирован или попытка недоступна.' });
      return;
    }
    res.json(choice);
  });

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
    const current: Task = res.locals.task;
    const owner: DemoIdentity['id'] = res.locals.identity.id;
    const run = input.runId ? store.readRun(input.runId, owner, current.id) : undefined;
    if (input.runId && !run) {
      res.status(404).json({ message: 'Прогон недоступен в этой задаче.' });
      return;
    }
    if (current.comparison && !run && input.mode !== 'manual'
      && (!input.attemptId || !store.noteHelp(input.attemptId, current.id, owner))) {
      res.status(409).json({ message: 'Открой поручение заново для новой попытки.' });
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
    const current: Task = res.locals.task;
    const owner: DemoIdentity['id'] = res.locals.identity.id;
    const priceTask = current.id === sortTask.id;
    const { preparation, attemptId, checkId: selectedCheck, ...input } = isObject(req.body) ? req.body : {};
    const order = priceTask ? parsePriceCheck(input) : undefined;
    const cities = priceTask ? undefined : parseChecks(input, current);
    const question = isObject(preparation) && typeof preparation.question === 'string' ? preparation.question.trim() : '';
    const checkId = isObject(preparation) && preparation.checkId;
    const hasPreparation = isObject(preparation) && preparation.source === 'buddy-draft' && question.length > 0 && question.length <= 500
      && (priceTask ? checkId === priceCheck.id : setPlan(current).checks.some(({ id }) => id === checkId));
    if ((!order && !cities) || (preparation !== undefined && !hasPreparation)) {
      res.status(400).json({ message: priceTask
        ? 'Задай ожидаемый порядок всех трёх объявлений.'
        : current.comparison ? 'Выбери ожидаемые статусы для обоих разрешённых запросов.'
          : 'Выбери ожидаемые города для обоих разрешённых запросов.' });
      return;
    }
    const choice = current.comparison && cities ? attemptChoice(cities, selectedCheck) : undefined;
    if (current.comparison && (!choice || typeof attemptId !== 'string')) {
      res.status(400).json({ message: 'Выбери основной запрос для своей проверки.' });
      return;
    }
    const locked = choice && typeof attemptId === 'string' ? store.lockAttempt(attemptId, current.id, owner) : undefined;
    if (choice && !locked) {
      res.status(409).json({ message: 'Попытка использована. Открой поручение заново.' });
      return;
    }
    let run;
    try {
      run = order ? await executePriceRun(standOrigin(), order) : await executeRun(standOrigin(), cities!, current,
        current.comparison ? inventoryHeaders : undefined);
    } catch {
      if (locked && typeof attemptId === 'string') store.releaseAttempt(attemptId, current.id, owner);
      res.status(502).json({ message: 'Стенд не ответил как ожидалось. Повтори запуск, ожидание сохранено.' });
      return;
    }
    if (hasPreparation) run.preparation = { question, checkId: checkId as Preparation['checkId'], source: 'buddy-draft' };
    if (locked && choice && typeof attemptId === 'string') {
      run.attempt = { first: locked.first, final: choice, help: locked.help };
      try {
        store.saveAttemptRun(attemptId, run, owner);
      } catch (error) {
        store.releaseAttempt(attemptId, current.id, owner);
        throw error;
      }
    } else store.saveRun(run, owner);
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
    if (!record || !taskFor(record.run.task.id, assignedTrainee(res.locals.identity.id))) {
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
    const current = taskFor(original.task.id, owner);
    const order = original.kind === 'price-order' && original.checks[0].path === priceCheck.path
      ? parsePriceCheck({ checks: original.checks.map(({ id, expectedOrder }) => ({ id, expectedOrder })) }) : undefined;
    const cities = current && original.kind !== 'price-order' && original.checks.every(({ id, path }) => setPlan(current).checks.some((check) => check.id === id && check.path === path))
      ? parseChecks({ checks: original.checks.map(({ id, expectedCities }) => ({ id, expectedCities })) }, current) : undefined;
    if (!order && !cities) {
      res.status(409).json({ message: 'Каталог изменился. Подготовь новый запрос по текущей инструкции.' });
      return;
    }
    let replay;
    try {
      replay = order ? await executePriceRun(standOrigin(), order) : await executeRun(standOrigin(), cities!, current,
        current?.comparison ? inventoryHeaders : undefined);
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
