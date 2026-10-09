import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { requireUser } from './auth.js';
import { HttpError } from './http.js';
import { createMailer } from './mailer.js';
import { authRouter } from './routes/auth.js';
import { projectsRouter } from './routes/projects.js';
import { tasksRouter } from './routes/tasks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ db, config, mailer = createMailer(config) }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
        "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    });
    if (config.production) res.set('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));

  // Proteção contra CSRF: escritas só são aceitas como JSON e de uma origem igual à do site.
  api.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch { /* origem inválida */ }
      if (host !== req.headers.host) return next(new HttpError(403, 'forbidden_origin', 'Origem não permitida.'));
    }
    if (!req.is('application/json')) return next(new HttpError(415, 'unsupported', 'Formato de requisição não suportado.'));
    if (req.body === undefined || req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    next();
  });
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.body === undefined) req.body = {};
    next();
  });

  api.use('/auth', authRouter({ db, config, mailer }));
  const guard = requireUser(db);
  api.use('/projects', guard, projectsRouter({ db }));
  api.use('/', guard, tasksRouter({ db }));
  api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Recurso não encontrado.')));
  app.use('/api', api);

  app.use('/vendor/sortable.min.js', (_req, res) =>
    res.sendFile(path.join(root, 'node_modules/sortablejs/Sortable.min.js')),
  );
  // Sem cache longo: o navegador revalida (ETag) e nunca mistura versões do JS/CSS após uma atualização.
  app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.fields && { fields: err.fields }) } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'bad_json', message: 'Requisição inválida.' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'too_large', message: 'Os dados enviados são grandes demais.' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'server_error', message: 'Erro inesperado no servidor. Tente novamente em instantes.' } });
  });

  return app;
}
