import { startServer } from './server.js';
import { closeConnections } from './db.js';

startServer().catch(async () => {
  console.error('API startup failed. Check service availability and port configuration.');
  await closeConnections();
  process.exitCode = 1;
});
