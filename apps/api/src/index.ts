import { buildApp } from './app.js';
import { config } from './config.js';
import { startScheduler } from './lib/scheduler.js';

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info(`${signal} — đang tắt`);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
app.log.info(`Car Rental v${config.version} · dữ liệu: ${config.dataDir}`);
startScheduler();
