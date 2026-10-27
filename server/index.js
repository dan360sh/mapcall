const config = require('./config');
const db = require('./db');
const { createServer } = require('./app');

// Логируем, но не падаем: состояние звонков живёт в памяти, и рестарт процесса
// разорвал бы все текущие соединения.
process.on('uncaughtException',  (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (r)   => console.error('[unhandledRejection]', r));

const { server } = createServer({ config, upsertUser: db.upsertUser });

db.initDb()
  .then(() => server.listen(config.port, () => console.log(`MapCall server → http://localhost:${config.port}`)))
  .catch((err) => { console.error('[db-init-failed]', err.message); process.exit(1); });

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => db.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
