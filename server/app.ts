import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import type { Workspace } from '../shared/contracts.ts';
import { parseBuddyQuestion, type createBuddy } from './buddy.ts';
import { checks, executeRun, listings, parseChecks, task, trainee } from './scenario.ts';
import { executePriceRun, parsePriceCheck, priceCheck, priceItems, sortTask } from './price-scenario.ts';
import type { createStore } from './store.ts';

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
  const session = randomBytes(24).toString('hex');

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
    if (filters.length === 1 && req.query.sort === 'price_asc') {
      // Намеренный дефект: null идёт первым, хотя состав выдачи полный.
      const items = priceItems.toSorted((a, b) => (a.price ?? -Infinity) - (b.price ?? -Infinity));
      res.json({ items });
      return;
    }
    if (filters.length && !(filters.length === 1 && req.query.city === 'kazan')) {
      res.status(400).json({ message: 'Разрешены запрос без параметров, city=kazan и sort=price_asc.' });
      return;
    }
    // В запросе без фильтра стенд намеренно теряет объявление из Самары.
    res.json({ items: listings.filter(({ city }) => city === 'kazan') });
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
    res.cookie(cookieName, session, { httpOnly: true, sameSite: 'strict', path: '/api' });
    const context = { tasks: assignedTasks, buddyMode: buddy.mode };
    const workspace: Workspace = selected === sortTask.id
      ? { ...context, kind: 'price-order', task: sortTask, checks: [priceCheck], orderItems: priceItems }
      : { ...context, task, checks: [...checks] };
    res.json(workspace);
  });

  const hasSession = (req: Request) => req.headers.cookie?.split(';').some((entry) => entry.trim() === `${cookieName}=${session}`);
  app.use('/api', (req, res, next) => {
    if (!hasSession(req)) {
      res.status(401).json({ message: 'Демо-сессия истекла. Обнови страницу.' });
      return;
    }
    next();
  });
  app.use('/api', express.json({ limit: '8kb' }));

  const assignedTask: RequestHandler = (req, res, next) => {
    if (!assignedTasks.some(({ id }) => id === req.params.taskId)) {
      res.status(404).json({ message: 'Задача недоступна в этой сессии.' });
      return;
    }
    next();
  };

  app.post('/api/tasks/:taskId/buddy', assignedTask, async (req, res) => {
    const input = parseBuddyQuestion(req.body);
    if (!input) {
      res.status(400).json({ message: 'Проверь вопрос и попробуй ещё раз. Максимум 500 символов.' });
      return;
    }
    res.json(await buddy.answer(req.params.taskId === sortTask.id ? sortTask : task, input));
  });

  app.post('/api/tasks/:taskId/runs', assignedTask, async (req, res) => {
    const priceTask = req.params.taskId === sortTask.id;
    const order = priceTask ? parsePriceCheck(req.body) : undefined;
    const cities = priceTask ? undefined : parseChecks(req.body);
    if (!order && !cities) {
      res.status(400).json({ message: priceTask
        ? 'Задай ожидаемый порядок всех трёх объявлений.'
        : 'Выбери ожидаемые города для обоих разрешённых запросов.' });
      return;
    }
    let run;
    try {
      run = order ? await executePriceRun(standOrigin(), order) : await executeRun(standOrigin(), cities!);
    } catch {
      res.status(502).json({ message: 'Стенд не ответил как ожидалось. Повтори запуск, выбранные города сохранены.' });
      return;
    }
    store.saveRun(run, trainee);
    res.status(201).json(run);
  });

  app.post('/api/tasks/:taskId/runs/:runId/publication', assignedTask, (req, res) => {
    const { record, created } = store.publish(String(req.params.runId), trainee, String(req.params.taskId));
    if (!record) {
      res.status(404).json({ message: 'Прогон недоступен в этой сессии.' });
      return;
    }
    res.status(created ? 201 : 200).json(record);
  });

  app.get('/api/records/:id', (req, res) => {
    const record = store.readRecord(req.params.id, trainee);
    if (!record || !assignedTasks.some(({ id }) => id === record.run.task.id)) {
      res.status(404).json({ message: 'Запись не найдена. Проверь ссылку или открой рабочее пространство.' });
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
