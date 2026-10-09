import path from 'node:path';

export function loadConfig(overrides = {}) {
  const port = Number(process.env.PORT) || 3000;
  const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  return {
    port,
    production: process.env.NODE_ENV === 'production',
    dbPath: process.env.DATABASE_PATH || path.resolve('data/follow.db'),
    baseUrl,
    smtpUrl: process.env.SMTP_URL || '',
    mailFrom: process.env.MAIL_FROM || 'Follow <nao-responder@localhost>',
    trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
    sessionDays: 30,
    resetMinutes: 60,
    rateLimit: true,
    ...overrides,
  };
}
