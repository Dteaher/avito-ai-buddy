import type { Express, RequestHandler } from 'express';
import type { DemoIdentity } from '../shared/contracts.ts';
import { assignedTrainee, findIdentity } from './demo-identities.ts';
import { authoringCatalog, parseDraft } from './task-catalog.ts';
import type { createStore } from './store.ts';

export function registerAuthoring(app: Express, store: ReturnType<typeof createStore>) {
  const authoring = store.authoring;
  const mentorOnly: RequestHandler = (_req, res, next) => {
    if (res.locals.identity.role !== 'mentor') {
      res.status(403).json({ message: 'Редактор доступен наставнику.' });
      return;
    }
    next();
  };
  const badDraft = 'Заполни название, описание, критерий и выбери проверки из каталога.';
  const outdated = 'Черновик обновился. Открой последнюю версию и повтори действие.';

  app.use('/api/mentor/tasks', mentorOnly);
  app.get('/api/mentor/tasks', (_req, res) => {
    const mentor: DemoIdentity = res.locals.identity;
    const trainee = assignedTrainee(mentor.id);
    res.json({ catalog: authoringCatalog, projects: authoring.list(mentor.id, trainee), trainees: [findIdentity(trainee)] });
  });
  app.post('/api/mentor/tasks', (req, res) => {
    const input = parseDraft(req.body);
    if (!input) {
      res.status(400).json({ message: badDraft });
      return;
    }
    res.status(201).json(authoring.create(res.locals.identity.id, input));
  });
  app.post('/api/mentor/tasks/:id/draft', (req, res) => {
    const mentor: DemoIdentity = res.locals.identity;
    const { basedOn, ...body } = req.body ?? {};
    const input = parseDraft(body);
    if (!input || typeof basedOn !== 'string') {
      res.status(400).json({ message: badDraft });
      return;
    }
    const draft = authoring.save(req.params.id, mentor.id, assignedTrainee(mentor.id), input, basedOn);
    if (!draft) {
      res.status(draft === null ? 409 : 404).json({ message: draft === null ? outdated : 'Поручение недоступно.' });
      return;
    }
    res.json(draft);
  });
  app.post('/api/mentor/tasks/:id/publish', (req, res) => {
    const mentor: DemoIdentity = res.locals.identity;
    const { revision } = req.body ?? {};
    if (typeof revision !== 'string') {
      res.status(400).json({ message: 'Сохрани черновик перед публикацией.' });
      return;
    }
    const result = authoring.publish(req.params.id, mentor.id, assignedTrainee(mentor.id), revision);
    if (!result) {
      res.status(result === null ? 409 : 404).json({ message: result === null ? outdated : 'Поручение недоступно.' });
      return;
    }
    if (result === 'incomplete') {
      res.status(400).json({ message: badDraft });
      return;
    }
    res.status(result.created ? 201 : 200).json(result.task);
  });
}
