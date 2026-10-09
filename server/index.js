import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

try { process.loadEnvFile?.(); } catch { /* sem .env: usa variáveis do ambiente */ }

const config = loadConfig();
const db = openDb(config.dbPath);
const app = createApp({ db, config });

const server = app.listen(config.port, () => {
  console.log(`Follow rodando em ${config.baseUrl} (porta ${config.port})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
