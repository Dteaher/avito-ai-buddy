import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { createBuddy } from './buddy.ts';
import { createStore } from './store.ts';
import { createTrackerClient, trackerConfig } from './tracker.ts';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть от 1 до 65535');

const origin = `http://127.0.0.1:${port}`;
const store = createStore(process.env.BUDDY_DB_PATH ?? resolve('.data', 'buddy.sqlite'));
const tracker = trackerConfig(process.env);
const app = createApp({ store, standOrigin: () => origin, buddy: createBuddy(process.env),
  tracker: createTrackerClient(tracker.origin, tracker.secret), staticDir: resolve('dist') });
const server = app.listen(port, '127.0.0.1', () => console.log(`AI-buddy · ${origin}`));

function stop() {
  server.close(() => store.close());
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
