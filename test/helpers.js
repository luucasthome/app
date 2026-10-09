import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';

export async function startServer(overrides = {}) {
  const db = openDb(':memory:');
  const mails = [];
  const config = loadConfig({ rateLimit: false, baseUrl: 'http://localhost', ...overrides });
  const app = createApp({ db, config, mailer: { send: async (m) => mails.push(m) } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, mails, base, close: () => new Promise((r) => { server.close(r); db.close(); }) };
}

// Cliente HTTP com "cookie jar" simples, para simular uma pessoa usando o app.
export function client(base) {
  let cookie = '';
  async function call(method, path, body, { raw = false, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }), ...headers },
      body: method === 'GET' ? undefined : raw ? body : JSON.stringify(body ?? {}),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, setCookie: set };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b, o) => call('POST', p, b, o),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p, {}),
    get cookie() { return cookie; },
  };
}

export async function signUp(base, name, email, password = 'senha-segura-1') {
  const c = client(base);
  const r = await c.post('/api/auth/register', { name, email, password });
  if (r.status !== 201) throw new Error(`cadastro falhou: ${JSON.stringify(r.body)}`);
  return c;
}
