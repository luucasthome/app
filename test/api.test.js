import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../server.js';
import { hashSenha } from '../src/auth.js';
import { spParaEpoch } from '../shared/tempo.js';

const dir = mkdtempSync(join(tmpdir(), 'beco-'));
const caminho = join(dir, 'teste.db');
let relogio = new Date(spParaEpoch('2026-10-23T19:00'));
let app, base, cookie = '';

async function iniciar() {
  const db = abrirBanco(caminho);
  if (!db.prepare('SELECT 1 FROM usuarios').get()) db.prepare('INSERT INTO usuarios (nome,hash,criadoEm) VALUES (?,?,?)').run('Lucas', hashSenha('senha-forte-123'), 'x');
  app = criarApp({ db, agora: () => relogio });
  await new Promise((r) => app.servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.servidor.address().port}`;
}
async function parar() { await new Promise((r) => app.servidor.close(r)); app.db.close(); }
async function chamar(metodo, url, corpo, { semCookie = false } = {}) {
  const r = await fetch(base + url, { method: metodo, headers: { ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie && !semCookie ? { Cookie: cookie } : {}) }, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

before(async () => { await iniciar(); });
after(async () => { await parar(); rmSync(dir, { recursive: true, force: true }); });

test('rotas de escrita exigem login; TV é pública', async () => {
  assert.equal((await chamar('GET', '/api/avisos', undefined, { semCookie: true })).status, 401);
  assert.equal((await chamar('POST', '/api/avisos', { titulo: 'x', mensagem: 'y' }, { semCookie: true })).status, 401);
  assert.equal((await chamar('GET', '/api/tv', undefined, { semCookie: true })).status, 200);
  assert.equal((await chamar('POST', '/api/login', { usuario: 'Lucas', senha: 'errada' })).status, 401);
  const ok = await chamar('POST', '/api/login', { usuario: 'lucas', senha: 'senha-forte-123' });
  assert.equal(ok.status, 200);
  assert.ok(cookie.startsWith('beco_sess='));
});

test('avisos: criar, validar e expirar automaticamente', async () => {
  const ruim = await chamar('POST', '/api/avisos', { titulo: '', mensagem: 'x' });
  assert.equal(ruim.status, 400); assert.ok(ruim.corpo.campos.titulo);
  const a = await chamar('POST', '/api/avisos', { titulo: 'Gás', mensagem: 'Trocar botijão', prioridade: 'urgente', fim: '2026-10-23T22:00', fixado: true });
  assert.equal(a.status, 201); assert.equal(a.corpo.autor, 'Lucas');
  assert.equal((await chamar('GET', '/api/tv')).corpo.avisos.length, 1);
  relogio = new Date(spParaEpoch('2026-10-23T22:00')); // chegou a hora de sair
  assert.equal((await chamar('GET', '/api/tv')).corpo.avisos.length, 0, 'aviso vencido some sozinho');
  assert.equal((await chamar('GET', '/api/avisos?estado=concluidos')).corpo.length, 1);
  relogio = new Date(spParaEpoch('2026-10-23T19:00'));
});

test('reservas: sem telefone na TV; canceladas e concluídas saem; evento em destaque', async () => {
  const r = await chamar('POST', '/api/reservas', { data: '2026-10-23', hora: '20:00', nome: 'Marina', pessoas: 6, contato: '11 98888-7777', notasPrivadas: 'alérgica a camarão' });
  assert.equal(r.status, 201);
  const sem = await chamar('POST', '/api/reservas', { data: '2026-10-23', hora: '20:30', nome: 'Beatriz' });
  assert.equal(sem.corpo.pessoas, null, 'campo vazio fica vazio, não 0');
  await chamar('POST', '/api/reservas', { tipo: 'evento', data: '2026-10-24', hora: '20:00', nome: 'Roda de samba' });
  let tv = await chamar('GET', '/api/tv');
  const txt = JSON.stringify(tv.corpo);
  assert.ok(!txt.includes('98888') && !txt.includes('camarão') && !txt.includes('contato'));
  assert.equal(tv.corpo.reservas.length, 2); assert.equal(tv.corpo.evento.nome, 'Roda de samba');
  await chamar('PUT', `/api/reservas/${r.corpo.id}`, { status: 'cancelada' });
  await chamar('POST', `/api/reservas/${sem.corpo.id}/concluir`, {});
  tv = await chamar('GET', '/api/tv');
  assert.equal(tv.corpo.reservas.length, 0);
  assert.equal(tv.corpo.secoes.reservas, 'ok', 'vazio não é erro');
  const sem2 = await chamar('GET', '/api/reservas?estado=periodo&de=2026-10-23&ate=2026-10-31');
  assert.equal(sem2.corpo.length, 3, 'a gestão ainda consulta todos no período');
});

test('pendências: atrasada continua, concluída sai; responsável obrigatório', async () => {
  assert.equal((await chamar('POST', '/api/pendencias', { acao: 'Algo', setor: 'Bar' })).status, 400);
  const p = await chamar('POST', '/api/pendencias', { acao: 'Chamar técnico', setor: 'Gerência', responsavel: 'Lucas', prazo: '2026-10-23T17:00', prioridade: 'alta' });
  const tv = (await chamar('GET', '/api/tv')).corpo;
  assert.equal(tv.pendencias.length, 1); assert.equal(tv.pendencias[0].atrasada, true);
  const c = await chamar('POST', `/api/pendencias/${p.corpo.id}/concluir`, {});
  assert.equal(c.corpo.status, 'concluida');
  assert.equal((await chamar('GET', '/api/tv')).corpo.pendencias.length, 0);
  assert.equal((await chamar('GET', '/api/pendencias?estado=concluidos')).corpo.length, 1);
  await chamar('POST', `/api/pendencias/${p.corpo.id}/reabrir`, {});
  assert.equal((await chamar('GET', '/api/tv')).corpo.pendencias.length, 1);
});

test('rotinas: cada dia tem o seu registro; concluir hoje não conclui amanhã', async () => {
  const r = await chamar('POST', '/api/rotinas', { nome: 'Conferir câmara fria', setor: 'Cozinha', responsavel: 'Rafael', etapa: 'operacao', dias: [0, 1, 2, 3, 4, 5, 6], hora: '20:00' });
  assert.equal(r.status, 201);
  await chamar('POST', `/api/rotinas/${r.corpo.id}/concluir`, {}); // hoje (sex 23)
  let det = (await chamar('GET', `/api/rotinas/${r.corpo.id}`)).corpo;
  const por = Object.fromEntries(det.ocorrencias.map((o) => [o.dia, o.status]));
  assert.equal(por['2026-10-23'], 'concluida'); assert.equal(por['2026-10-24'], 'pendente');
  assert.equal(new Set(det.ocorrencias.map((o) => o.id)).size, 3, 'registros distintos');
  // virou o dia: a TV mostra a ocorrência de amanhã pendente
  relogio = new Date(spParaEpoch('2026-10-24T19:00'));
  const tv = (await chamar('GET', '/api/tv')).corpo;
  assert.equal(tv.dia, '2026-10-24');
  assert.equal(tv.rotinas.find((o) => o.nome === 'Conferir câmara fria').status, 'pendente');
  // após a meia-noite ainda é o dia operacional anterior (turno da noite)
  relogio = new Date(spParaEpoch('2026-10-25T00:40'));
  assert.equal((await chamar('GET', '/api/tv')).corpo.dia, '2026-10-24');
  // rotina só em dias úteis não gera ocorrência no domingo
  const du = await chamar('POST', '/api/rotinas', { nome: 'Pedido do hortifruti', setor: 'Cozinha', responsavel: 'Rafael', dias: [1, 2, 3, 4, 5], hora: '09:00' });
  relogio = new Date(spParaEpoch('2026-10-25T12:00')); // domingo
  const dom = (await chamar('GET', '/api/tv')).corpo;
  assert.ok(!dom.rotinas.some((o) => o.nome === 'Pedido do hortifruti'));
  relogio = new Date(spParaEpoch('2026-10-23T19:00'));
  void du;
});

test('histórico registra quem mudou o quê; duplicar e arquivar', async () => {
  const a = (await chamar('POST', '/api/avisos', { titulo: 'Teste', mensagem: 'm' })).corpo;
  await chamar('PUT', `/api/avisos/${a.id}`, { prioridade: 'atencao' });
  const d = (await chamar('POST', `/api/avisos/${a.id}/duplicar`, {})).corpo;
  assert.notEqual(d.id, a.id);
  await chamar('POST', `/api/avisos/${a.id}/arquivar`, {});
  const h = (await chamar('GET', `/api/historico?entidade=avisos&id=${a.id}`)).corpo;
  assert.deepEqual(h.map((x) => x.acao).reverse(), ['criou', 'alterou', 'arquivou']);
  assert.match(h.find((x) => x.acao === 'alterou').resumo, /prioridade: info → atencao/);
  assert.ok(h.every((x) => x.autor === 'Lucas'));
  assert.ok(!(await chamar('GET', '/api/avisos')).corpo.some((x) => x.id === a.id), 'arquivado sai da lista ativa');
});

test('persistência: dados continuam após fechar e reabrir o banco', async () => {
  const antes = (await chamar('GET', '/api/pendencias')).corpo.length;
  assert.ok(antes > 0);
  await parar();
  await iniciar();
  const depois = await chamar('GET', '/api/pendencias'); // o cookie continua válido (segredo persistido)
  assert.equal(depois.status, 200);
  assert.equal(depois.corpo.length, antes);
});

test('seção com falha vira "erro" sem derrubar o resto', async () => {
  app.db.exec('ALTER TABLE pendencias RENAME TO pendencias_x');
  try {
    const tv = (await chamar('GET', '/api/tv')).corpo;
    assert.equal(tv.secoes.pendencias, 'erro'); assert.equal(tv.secoes.avisos, 'ok');
  } finally { app.db.exec('ALTER TABLE pendencias_x RENAME TO pendencias'); }
});

test('config: tempo por página validado', async () => {
  assert.equal((await chamar('PUT', '/api/config', { paginaSegundos: 3 })).status, 400);
  assert.equal((await chamar('PUT', '/api/config', { paginaSegundos: 40 })).corpo.paginaSegundos, 40);
  assert.equal((await chamar('GET', '/api/tv')).corpo.config.paginaSegundos, 40);
});
