import type { Express, RequestHandler } from 'express';
import type { DemoIdentity } from '../shared/contracts.ts';
import { taskInsights } from '../shared/task-insights.ts';
import { authoringTrainees } from './demo-identities.ts';
import { authoringCatalog, parseDraft, publishTask } from './task-catalog.ts';
import type { createBuddy } from './buddy.ts';
import type { createStore } from './store.ts';

export function registerAuthoring(app: Express, store: ReturnType<typeof createStore>, buddy: ReturnType<typeof createBuddy>) {
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
    res.json({ catalog: authoringCatalog, projects: authoring.list(mentor.id), trainees: authoringTrainees, canSuggest: buddy.mode === 'model' });
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
    const draft = authoring.save(req.params.id, mentor.id, input, basedOn);
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
    const result = authoring.publish(req.params.id, mentor.id, revision);
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

  app.post('/api/mentor/tasks/:id/clarification-suggestion', async (req, res) => {
    const mentor: DemoIdentity = res.locals.identity;
    const { versionId, section, meaning, input: rawInput } = req.body ?? {};
    const version = typeof versionId === 'string' ? authoring.version(versionId, mentor.id) : undefined;
    if (!version || version.authoringId !== req.params.id) {
      res.status(404).json({ message: 'Версия поручения недоступна.' });
      return;
    }
    const input = parseDraft(rawInput);
    if ((section !== 'criterion' && section !== 'description') || typeof meaning !== 'string'
      || meaning.trim().length > 400 || !input?.checkIds.length) {
      res.status(400).json({ message: 'Укажи пояснение до 400 символов и выбери проверку в черновике.' });
      return;
    }
    const participants = authoring.participants(version.id, mentor.id);
    if (!participants.some(({ clarification }) => clarification?.section === section)) {
      res.status(404).json({ message: 'В этой версии нет вопроса по выбранному полю.' });
      return;
    }
    const observation = taskInsights(version, participants).find((item) => item.section === section && input.checkIds.includes(item.checkId))?.text;
    if (!meaning.trim() && !observation) {
      res.status(400).json({ message: 'Укажи, что именно нужно уточнить.' });
      return;
    }
    if (buddy.mode !== 'model') {
      res.status(503).json({ message: 'Для предложения нужна подключённая модель Buddy.' });
      return;
    }
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const suggestion = await buddy.suggestClarification(publishTask(req.params.id, 1, input), section, meaning.trim(), controller.signal, observation);
      if (!controller.signal.aborted) res.json(suggestion);
    } catch {
      if (!controller.signal.aborted) res.status(502).json({ message: 'Buddy не подготовил правку. Попробуй ещё раз или уточни текст вручную.' });
    }
  });
}
