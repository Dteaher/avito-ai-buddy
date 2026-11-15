import { resolve } from 'node:path';
import { createTrackerService, trackerConfig } from './tracker.ts';

const { port, origin, secret } = trackerConfig(process.env);
const tracker = createTrackerService(process.env.TRACKER_DB_PATH ?? resolve('.data', 'tracker.sqlite'), secret);
const server = tracker.app.listen(port, '127.0.0.1', () => console.log(`Демо-трекер · ${origin}`));

function stop() {
  server.close(() => tracker.close());
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
