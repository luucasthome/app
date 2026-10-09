import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { client, signUp, startServer } from './helpers.js';

let s;
before(async () => { s = await startServer(); });
after(() => s.close());

describe('autenticação', () => {
  it('exige login para acessar projetos', async () => {
    const r = await client(s.base).get('/api/projects');
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'unauthenticated');
  });

  it('cadastra, mantém a sessão por cookie HttpOnly e permite sair/entrar', async () => {
    const c = client(s.base);
    const reg = await c.post('/api/auth/register', { name: 'Ana', email: 'Ana@Exemplo.com', password: 'senha-segura-1' });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.user.email, 'ana@exemplo.com');
    assert.match(reg.setCookie.join(';'), /HttpOnly/i);
    assert.match(reg.setCookie.join(';'), /SameSite=Lax/i);
    assert.equal((await c.get('/api/auth/me')).body.user.name, 'Ana');

    await c.post('/api/auth/logout', {});
    assert.equal((await c.get('/api/auth/me')).status, 401);

    const bad = await c.post('/api/auth/login', { email: 'ana@exemplo.com', password: 'errada-errada' });
    assert.equal(bad.status, 401);
    const ok = await c.post('/api/auth/login', { email: 'ana@exemplo.com', password: 'senha-segura-1' });
    assert.equal(ok.status, 200);
    assert.equal((await c.get('/api/auth/me')).status, 200);
  });

  it('valida campos com mensagens claras', async () => {
    const c = client(s.base);
    const r = await c.post('/api/auth/register', { name: '', email: 'nao-e-email', password: '123' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.fields.name && r.body.error.fields.email && r.body.error.fields.password);
  });

  it('impede e-mail duplicado, inclusive em envios simultâneos', async () => {
    const payload = { name: 'Bia', email: 'bia@exemplo.com', password: 'senha-segura-1' };
    const results = await Promise.all([1, 2, 3].map(() => client(s.base).post('/api/auth/register', payload)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.filter((r) => r.status === 409).length >= 1);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM users WHERE email='bia@exemplo.com'").get().n, 1);
  });

  it('armazena a senha apenas como hash', async () => {
    const row = s.db.prepare("SELECT password_hash FROM users WHERE email='ana@exemplo.com'").get();
    assert.ok(row.password_hash.startsWith('scrypt$'));
    assert.ok(!row.password_hash.includes('senha-segura-1'));
  });

  it('recuperação de senha: link funciona uma vez, troca a senha e encerra sessões', async () => {
    const c = await signUp(s.base, 'Caio', 'caio@exemplo.com');
    const before = s.mails.length;

    const unknown = await client(s.base).post('/api/auth/forgot', { email: 'ninguem@exemplo.com' });
    const known = await client(s.base).post('/api/auth/forgot', { email: 'caio@exemplo.com' });
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body, known.body); // não revela quem tem conta
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(s.mails.length, before + 1);

    const token = decodeURIComponent(s.mails.at(-1).text.match(/token=([^\s]+)/)[1]);
    const anon = client(s.base);
    assert.equal((await anon.post('/api/auth/reset', { token, password: 'curta' })).status, 400);
    assert.equal((await anon.post('/api/auth/reset', { token: 'invalido', password: 'nova-senha-123' })).body.error.code, 'invalid_token');
    assert.equal((await anon.post('/api/auth/reset', { token, password: 'nova-senha-123' })).status, 200);
    assert.equal((await anon.post('/api/auth/reset', { token, password: 'outra-senha-123' })).status, 400); // uso único

    assert.equal((await c.get('/api/auth/me')).status, 401); // sessão antiga encerrada
    assert.equal((await anon.post('/api/auth/login', { email: 'caio@exemplo.com', password: 'senha-segura-1' })).status, 401);
    assert.equal((await anon.post('/api/auth/login', { email: 'caio@exemplo.com', password: 'nova-senha-123' })).status, 200);
  });

  it('token de recuperação expirado é recusado', async () => {
    await signUp(s.base, 'Duda', 'duda@exemplo.com');
    await client(s.base).post('/api/auth/forgot', { email: 'duda@exemplo.com' });
    await new Promise((r) => setTimeout(r, 20));
    const token = decodeURIComponent(s.mails.at(-1).text.match(/token=([^\s]+)/)[1]);
    s.db.prepare("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    const r = await client(s.base).post('/api/auth/reset', { token, password: 'nova-senha-123' });
    assert.equal(r.status, 400);
  });

  it('recusa escritas que não sejam JSON ou venham de outra origem (CSRF)', async () => {
    const c = await signUp(s.base, 'Eva', 'eva@exemplo.com');
    const form = await c.post('/api/projects', 'name=x', { raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    const cross = await c.post('/api/projects', { name: 'x' }, { headers: { Origin: 'https://malicioso.example' } });
    assert.equal(cross.status, 403);
  });
});

describe('limite de tentativas de login', () => {
  it('bloqueia depois de muitas tentativas erradas', async () => {
    const limited = await startServer({ rateLimit: true });
    try {
      await signUp(limited.base, 'Fábio', 'fabio@exemplo.com');
      const c = client(limited.base);
      let last;
      for (let i = 0; i < 12; i++) last = await c.post('/api/auth/login', { email: 'fabio@exemplo.com', password: 'errada-errada' });
      assert.equal(last.status, 429);
    } finally {
      await limited.close();
    }
  });
});
