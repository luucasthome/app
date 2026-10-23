// Teste de ponta a ponta no navegador (Chromium via Playwright). Uso: npm run e2e
// Sobe o servidor com banco temporário, popula com excesso de conteúdo e confere TV + celular.
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { abrirBanco } from '../../src/db.js';
import { criarApp } from '../../server.js';
import { hashSenha } from '../../src/auth.js';

const require = createRequire(process.env.PLAYWRIGHT_DIR || '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const SAIDA = new URL('./out/', import.meta.url).pathname;
mkdirSync(SAIDA, { recursive: true });

const dir = mkdtempSync(join(tmpdir(), 'beco-e2e-'));
const caminho = join(dir, 'e2e.db');
let db = abrirBanco(caminho);
db.prepare('INSERT INTO usuarios (nome,hash,criadoEm) VALUES (?,?,?)').run('gerencia', hashSenha('senha-e2e-123'), 'x');
let app = criarApp({ db });
await new Promise((r) => app.servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.servidor.address().port}`;

const resultados = [];
const ok = (nome) => { resultados.push(nome); console.log('  ✔', nome); };

let cookie = '';
async function api(metodo, url, corpo) {
  const r = await fetch(base + url, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return r.json();
}
await api('POST', '/api/login', { usuario: 'gerencia', senha: 'senha-e2e-123' });

// ---------- conteúdo com excesso e textos longos ----------
const hoje = (await api('GET', '/api/tv')).dia;
const futuro = (h) => { const d = new Date(Date.now() + h * 3600e3); return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(d).replace(' ', 'T'); };
await api('POST', '/api/avisos', { titulo: 'Fogão 2 sem gás', mensagem: 'Usar fogão 1 e chapa até o técnico chegar, previsto para as 20h.', prioridade: 'urgente', fixado: true });
await api('POST', '/api/avisos', { titulo: 'Sexta lotada', mensagem: 'Repor gelo e couvert antes das 20h. Reforço no salão e no bar.', prioridade: 'atencao' });
await api('POST', '/api/avisos', { titulo: 'Prato do dia', mensagem: 'Costela de 12h. Avisar a mesa que acaba cedo.', prioridade: 'info' });
for (let i = 0; i < 14; i++) {
  await api('POST', '/api/reservas', { data: hoje, hora: `${String(19 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`, nome: i % 5 === 0 ? 'Grupo Almeida e Associados' : `Cliente ${i + 1}`, pessoas: i % 3 ? 2 + i : null, mesa: i % 2 ? `Mesa ${i}` : '', setor: 'Salão', obs: i % 4 === 0 ? 'Aniversário, bolo e velas trazidos' : '', contato: '(11) 91234-5678', notasPrivadas: 'NAO-PODE-APARECER' });
}
await api('POST', '/api/reservas', { tipo: 'evento', data: hoje, hora: '23:00', nome: 'Roda de samba', obs: 'mesas só com reserva' });
for (let i = 0; i < 11; i++) {
  await api('POST', '/api/pendencias', { acao: i === 3 ? 'Chamar o técnico da câmara fria para revisar o motor' : `Tarefa ${i + 1}`, setor: ['Bar', 'Cozinha', 'Salão', 'Gerência'][i % 4], responsavel: 'Rafael', prazo: futuro(i === 0 ? -5 : i === 1 ? -30 : i * 3), prioridade: i < 2 ? 'alta' : i % 2 ? 'media' : 'baixa', status: i === 1 ? 'impedimento' : 'pendente' });
}
for (let i = 0; i < 9; i++) {
  await api('POST', '/api/rotinas', { nome: `Rotina de teste ${i + 1}`, setor: 'Salão', responsavel: 'Camila', etapa: 'operacao', dias: [0, 1, 2, 3, 4, 5, 6], hora: `${String(6 + i * 2).padStart(2, '0')}:00` });
}
await api('PUT', '/api/config', { paginaSegundos: 10, turnos: [{ nome: 'integral', inicio: '00:00', fim: '23:59' }] });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const erros = [];
const novaPagina = async (ctx, vp) => { const p = await ctx.newPage(); p.on('pageerror', (e) => erros.push(e.message)); return p; };

try {
  // ---------- TV 1080p: excesso sem cortes ----------
  console.log('TV 1920x1080');
  const ctxTv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await novaPagina(ctxTv);
  await tv.goto(`${base}/tv?poll=3&stale=8`, { waitUntil: 'networkidle' });
  await tv.waitForFunction(() => window.__tv && window.__tv.total > 1);
  const total = await tv.evaluate(() => window.__tv.total);
  assert.ok(total >= 3, `esperava várias páginas, veio ${total}`);

  const vistos = { reservas: new Set(), pendencias: new Set(), rotinas: new Set() };
  const conferirPagina = async () => tv.evaluate(() => {
    const out = { problemas: [], ids: {} };
    for (const nome of ['reservas', 'pendencias', 'rotinas']) {
      const lista = document.getElementById(`lista-${nome}`);
      const caixa = lista.getBoundingClientRect();
      out.ids[nome] = [...lista.querySelectorAll('[data-id]')].map((e) => e.dataset.id);
      for (const el of lista.querySelectorAll('.item')) {
        const r = el.getBoundingClientRect();
        if (r.bottom > caixa.bottom + 1) out.problemas.push(`${nome}: item ultrapassa a coluna`);
      }
      for (const el of lista.querySelectorAll('.item__titulo, .item__sub, .hora')) {
        if (el.scrollWidth > el.clientWidth + 1) out.problemas.push(`${nome}: texto estourando na largura`);
      }
    }
    for (const el of document.querySelectorAll('.aviso__msg, .aviso__titulo')) if (el.scrollWidth > el.clientWidth + 1) out.problemas.push('aviso: texto estourando');
    const rod = document.querySelector('.rodape').getBoundingClientRect();
    if (rod.bottom > window.innerHeight + 1) out.problemas.push('rodapé fora da tela');
    const colunas = document.querySelector('.colunas').getBoundingClientRect();
    if (rod.top < colunas.bottom - 1) out.problemas.push('colunas invadem o rodapé');
    const atencao = document.querySelectorAll('#avisos .aviso').length;
    if (atencao !== 3) out.problemas.push(`avisos visíveis: ${atencao}`);
    out.pag = window.__tv.pagina;
    return out;
  });
  const paginasVistas = new Set();
  for (let guarda = 0; guarda < total * 2 + 2 && paginasVistas.size < total; guarda++) {
    await tv.waitForTimeout(600);
    const r = await conferirPagina();
    assert.deepEqual(r.problemas, [], `página ${r.pag + 1}: ${r.problemas.join('; ')}`);
    if (!paginasVistas.has(r.pag)) {
      paginasVistas.add(r.pag);
      await tv.screenshot({ path: `${SAIDA}tv-pagina-${r.pag + 1}.png` });
      for (const k of Object.keys(vistos)) r.ids[k].forEach((id) => vistos[k].add(id));
    }
    if (paginasVistas.size < total) await tv.waitForFunction((p) => window.__tv.pagina !== p, r.pag, { timeout: 20000 });
  }
  assert.equal(paginasVistas.size, total, 'todas as páginas foram exibidas');
  assert.equal(vistos.reservas.size, 14, 'todas as 14 reservas apareceram em alguma página');
  assert.equal(vistos.pendencias.size, 11, 'todas as 11 pendências apareceram');
  assert.ok(vistos.rotinas.size >= 9, 'todas as rotinas apareceram');
  const html = await tv.content();
  assert.ok(!html.includes('NAO-PODE-APARECER') && !html.includes('91234'), 'dados privados não chegam à TV');
  ok(`excesso (14 reservas, 11 pendências, 9 rotinas) distribuído em ${total} páginas, sem texto cortado nem estourado`);

  // pendências críticas ficam visíveis em todas as páginas
  // (conferido na última página capturada)
  const criticos = await tv.evaluate(() => document.querySelectorAll('#lista-pendencias .pendencia--atrasada').length);
  assert.ok(criticos >= 1, 'pendência atrasada continua visível na página atual');
  ok('pendência atrasada permanece visível com o rótulo “Atrasada”');

  // ---------- edição no celular -> TV ----------
  console.log('Celular -> TV');
  const ctxCel = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cel = await novaPagina(ctxCel);
  await cel.goto(`${base}/gestao`);
  await cel.fill('#u', 'gerencia'); await cel.fill('#s', 'senha-e2e-123'); await cel.click('button[type=submit]');
  await cel.waitForSelector('.g-home-grade');
  await cel.screenshot({ path: `${SAIDA}cel-inicio.png` });
  await cel.goto(`${base}/gestao#/avisos/novo`);
  await cel.waitForSelector('#c_titulo');
  await cel.fill('#c_titulo', 'Sem gelo no bar');
  await cel.fill('#c_mensagem', 'Chegada do gelo só às 21h.');
  await cel.click('[data-seg=prioridade] [data-valor=urgente]');
  await cel.screenshot({ path: `${SAIDA}cel-novo-aviso.png`, fullPage: true });
  const t0 = Date.now();
  await cel.click('#salvar');
  await cel.waitForSelector('#toast:not([hidden])');
  await tv.waitForFunction(() => document.getElementById('avisos').textContent.includes('Sem gelo no bar'), null, { timeout: 30000 });
  const dt = (Date.now() - t0) / 1000;
  assert.ok(dt <= 30, `demorou ${dt}s`);
  ok(`aviso criado no celular apareceu na TV em ${dt.toFixed(1)} s (sincronização de teste a cada 3 s; em produção 15 s, meta ≤ 30 s)`);
  await tv.screenshot({ path: `${SAIDA}tv-apos-edicao.png` });

  // concluir pendência com um toque após abrir o item
  const pend = (await api('GET', '/api/pendencias')).find((p) => p.acao === 'Tarefa 1');
  await cel.goto(`${base}/gestao#/pendencias/${pend.id}`);
  await cel.waitForSelector('[data-acao=concluir]');
  await cel.screenshot({ path: `${SAIDA}cel-pendencia.png`, fullPage: true });
  await cel.click('[data-acao=concluir]');
  await cel.waitForSelector('#toast:not([hidden])');
  assert.equal((await api('GET', `/api/pendencias/${pend.id}`)).status, 'concluida');
  ok('pendência concluída com um único toque depois de abrir o item');

  // reservas: dia, semana e mês
  await cel.goto(`${base}/gestao#/reservas`);
  await cel.waitForSelector('.g-nav');
  for (const v of ['dia', 'semana', 'mes']) {
    await cel.click(`[data-visao=${v}]`); await cel.waitForTimeout(500);
    await cel.screenshot({ path: `${SAIDA}cel-reservas-${v}.png`, fullPage: true });
  }
  ok('gestão de reservas abre em dia, semana e mês');

  // ---------- falha de conexão e recuperação ----------
  console.log('Conexão');
  await ctxTv.setOffline(true);
  await tv.waitForSelector('#faixa-stale.on', { timeout: 20000 });
  const faixa = await tv.textContent('#faixa-stale');
  assert.match(faixa, /DADOS DESATUALIZADOS/);
  assert.match(await tv.textContent('#rodape-sync'), /sem conexão/);
  assert.ok((await tv.textContent('#lista-reservas')).length > 20, 'continua mostrando o último conteúdo');
  await tv.screenshot({ path: `${SAIDA}tv-sem-conexao.png` });
  ok('sem conexão: último conteúdo continua na tela com aviso de desatualização e horário da última sincronização');

  await ctxTv.setOffline(false);
  await tv.waitForFunction(() => !document.getElementById('faixa-stale').classList.contains('on'), null, { timeout: 20000 });
  ok('conexão volta: a TV se recupera sozinha, sem recarregar a página');

  // ---------- persistência ----------
  console.log('Persistência');
  const antes = (await api('GET', '/api/avisos')).length;
  await new Promise((r) => app.servidor.close(r)); app.db.close();
  db = abrirBanco(caminho); app = criarApp({ db });
  await new Promise((r) => app.servidor.listen(Number(new URL(base).port), '127.0.0.1', r));
  assert.equal((await api('GET', '/api/avisos')).length, antes);
  ok('dados e sessão sobrevivem a reiniciar o servidor');

  // ---------- 4K ----------
  console.log('TV 3840x2160');
  const ctx4k = await browser.newContext({ viewport: { width: 3840, height: 2160 } });
  const tv4k = await novaPagina(ctx4k);
  await tv4k.goto(`${base}/tv`, { waitUntil: 'networkidle' });
  await tv4k.waitForFunction(() => window.__tv);
  await tv4k.waitForTimeout(800);
  const esc4k = await tv4k.evaluate(() => document.getElementById('stage').getBoundingClientRect().width);
  assert.ok(Math.abs(esc4k - 3840) < 2, `palco em 4K mede ${esc4k}`);
  await tv4k.screenshot({ path: `${SAIDA}tv-4k.png` });
  ok('4K: mesmo layout em escala 2x preenchendo a tela');

  assert.deepEqual(erros, [], `erros de JavaScript: ${erros.join('; ')}`);
  ok('nenhum erro de JavaScript no console');
} finally {
  await browser.close();
  await new Promise((r) => app.servidor.close(r));
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${resultados.length} verificações OK`);
