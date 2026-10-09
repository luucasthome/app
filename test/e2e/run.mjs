// Verificação ponta a ponta em navegador real (Chromium via Playwright).
// Uso: PLAYWRIGHT_MODULE=/caminho/playwright/index.mjs node test/e2e/run.mjs [pasta-de-capturas]
// Sobe um servidor temporário com banco em memória; não toca nos seus dados.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { openDb } from '../../server/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const shots = process.argv[2] || 'test-results';
fs.mkdirSync(shots, { recursive: true });

const db = openDb(':memory:');
const mails = [];
const config = loadConfig({ rateLimit: false });
const server = await new Promise((r) => {
  const s = createApp({ db, config, mailer: { send: async (m) => mails.push(m) } }).listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

const problems = [];
const pages = [];
const watch = (page, label) => {
  pages.push([label, page]);
  page.on('console', (m) => {
    // "Failed to load resource" é só o navegador anotando respostas 4xx esperadas (ex.: 401 antes do login).
    if (['error', 'warning'].includes(m.type()) && !/Failed to load resource/.test(m.text())) problems.push(`[${label}] console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
};
let step = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
// espera as animações dos diálogos terminarem antes de capturar
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${shots}/${String(++step).padStart(2, '0')}-${name}.png` }); };

const cardTitles = (page, col) => page.locator(`.card-list[data-column="${col}"] .card-title`).allTextContents();

async function dragCard(page, fromTitle, toColumn, beforeTitle) {
  const card = page.locator('.card', { hasText: fromTitle }).first();
  const cb = await card.boundingBox();
  let tx; let ty;
  if (beforeTitle) {
    const t = await page.locator('.card', { hasText: beforeTitle }).first().boundingBox();
    tx = t.x + t.width / 2; ty = t.y + 4;
  } else {
    const list = await page.locator(`.card-list[data-column="${toColumn}"]`).boundingBox();
    tx = list.x + list.width / 2; ty = list.y + list.height - 6;
  }
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 10, cb.y + cb.height / 2 + 10, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(500);
}

async function signUp(page, name, email, password) {
  await page.goto(`${base}/`);
  await page.waitForURL(/#\/entrar/);
  await page.click('text=Criar conta');
  await page.fill('input[name=name]', name);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('button[type=submit]');
  await page.waitForURL(/#\/projetos/);
}

try {
  // ================= COMPUTADOR =================
  console.log('Computador (1280x800)');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  watch(page, 'desktop');

  await page.goto(`${base}/`);
  await page.waitForURL(/#\/entrar/);
  await shot(page, 'login');
  await page.click('text=Criar conta');
  await page.click('button[type=submit]');
  assert.match(await page.locator('.field-error:visible').first().innerText(), /Informe seu nome/);
  await page.fill('input[name=name]', 'Lucas');
  await page.fill('input[name=email]', 'lucas@exemplo.com');
  await page.fill('input[name=password]', 'curta');
  await page.click('button[type=submit]');
  assert.match(await page.locator('.field-error:visible').first().innerText(), /pelo menos 8 caracteres/);
  await page.fill('input[name=password]', 'senha-segura-1');
  await page.click('button[type=submit]');
  await page.waitForURL(/#\/projetos/);
  ok('cadastro com validação e acesso ao app');

  // estado vazio
  await page.waitForSelector('text=Você ainda não tem projetos');
  await shot(page, 'projetos-vazio');
  ok('estado vazio da lista de projetos (sem exemplos automáticos)');

  // projeto: validação, criação
  await page.click('.page-head >> text=Novo projeto');
  await page.click('dialog button[type=submit]');
  assert.match(await page.locator('dialog .field-error:visible').innerText(), /nome do projeto/);
  await page.fill('dialog input[name=name]', 'Site novo');
  await page.fill('dialog textarea[name=description]', 'Redesenho do site institucional.');
  await page.fill('dialog input[name=due_date]', '2026-12-31');
  await shot(page, 'novo-projeto');
  await page.click('dialog button[type=submit]');
  await page.waitForURL(/#\/projeto\//);
  await page.waitForSelector('h1:has-text("Site novo")');
  const projectUrl = page.url();
  await page.waitForSelector('text=Este projeto ainda não tem tarefas');
  await shot(page, 'quadro-vazio');
  ok('projeto criado; quadro vazio orienta o próximo passo');

  // tarefa só com título
  await page.click('.board-actions >> text=Nova tarefa');
  await page.click('dialog button[type=submit]');
  assert.match(await page.locator('dialog .field-error:visible').innerText(), /título/);
  await page.fill('dialog input[name=title]', 'Escrever briefing');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('.card:has-text("Escrever briefing")');
  assert.deepEqual(await cardTitles(page, 'todo'), ['Escrever briefing']);
  assert.ok(await page.locator('.card:has-text("Escrever briefing") .prio-medium').count());
  ok('tarefa criada só com título (prioridade média por padrão)');

  // tarefa completa: prioridade alta, prazo vencido, checklist
  await page.click('.board-actions >> text=Nova tarefa');
  await page.fill('dialog input[name=title]', 'Revisar contrato');
  await page.click('dialog .seg-high');
  await page.fill('dialog input[name=due_date]', '2020-01-15');
  await page.selectOption('dialog select[name=column]', 'doing');
  await page.fill('dialog textarea[name=description]', 'Ver cláusulas de prazo.');
  await page.fill('dialog input[aria-label="Nova etapa do checklist"]', 'Ler texto');
  await page.keyboard.press('Enter');
  await page.fill('dialog input[aria-label="Nova etapa do checklist"]', 'Enviar comentários');
  await page.keyboard.press('Enter');
  await page.locator('dialog .check-item input[type=checkbox]').first().check();
  await shot(page, 'painel-tarefa');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('.card-list[data-column=doing] .card:has-text("Revisar contrato")');
  const late = page.locator('.card:has-text("Revisar contrato")');
  assert.match(await late.innerText(), /Atrasada · 15\/01\/2020/);
  assert.match(await late.innerText(), /1\/2/);
  assert.match(await late.innerText(), /Alta/);
  ok('prioridade, atraso (ícone + texto, formato dd/mm/aaaa) e progresso do checklist no cartão');

  // mais tarefas pelo botão "+" da coluna
  for (const t of ['Definir escopo', 'Montar cronograma']) {
    await page.click('button[aria-label="Adicionar tarefa em A fazer"]');
    await page.fill('dialog input[name=title]', t);
    await page.click('dialog button[type=submit]');
    await page.waitForSelector(`.card:has-text("${t}")`);
  }
  assert.deepEqual(await cardTitles(page, 'todo'), ['Escrever briefing', 'Definir escopo', 'Montar cronograma']);
  await shot(page, 'quadro');

  // arrastar entre colunas e reordenar
  await dragCard(page, 'Definir escopo', 'review');
  assert.deepEqual(await cardTitles(page, 'review'), ['Definir escopo']);
  await dragCard(page, 'Montar cronograma', 'todo', 'Escrever briefing');
  assert.deepEqual(await cardTitles(page, 'todo'), ['Montar cronograma', 'Escrever briefing']);
  await dragCard(page, 'Escrever briefing', 'doing', 'Revisar contrato');
  assert.deepEqual(await cardTitles(page, 'doing'), ['Escrever briefing', 'Revisar contrato']);
  ok('arrastar entre colunas e reordenar dentro da coluna');
  await page.reload();
  await page.waitForSelector('.card');
  assert.deepEqual(await cardTitles(page, 'todo'), ['Montar cronograma']);
  assert.deepEqual(await cardTitles(page, 'doing'), ['Escrever briefing', 'Revisar contrato']);
  assert.deepEqual(await cardTitles(page, 'review'), ['Definir escopo']);
  ok('posições preservadas após recarregar a página');

  // mover pelo formulário (alternativa ao arraste) e teclado
  await page.focus('.card:has-text("Montar cronograma") .card-body');
  await page.keyboard.press('Enter');
  await page.selectOption('dialog select[name=column]', 'done');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('.card-list[data-column=done] .card:has-text("Montar cronograma")');
  ok('mudar de coluna pelo formulário (cartão aberto pelo teclado)');
  assert.match(await page.locator('.progress-text').first().innerText(), /1 de 4 concluídas · 25%/);
  ok('progresso do projeto = tarefas em Concluído / total');

  // busca e filtros
  await page.fill('.toolbar input[type=search]', 'contrato');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.card').count(), 1);
  await page.fill('.toolbar input[type=search]', 'xyz');
  await page.waitForSelector('text=Nenhuma tarefa encontrada');
  await shot(page, 'busca-sem-resultados');
  await page.click('.empty >> text=Limpar busca e filtros');
  assert.equal(await page.locator('.card').count(), 4);
  await page.selectOption('.toolbar select[aria-label="Filtrar por prazo"]', 'overdue');
  assert.deepEqual(await page.locator('.card .card-title').allTextContents(), ['Revisar contrato']);
  await page.selectOption('.toolbar select[aria-label="Filtrar por prazo"]', 'none');
  assert.equal(await page.locator('.card').count(), 3);
  await page.selectOption('.toolbar select[aria-label="Filtrar por prioridade"]', 'medium');
  await page.fill('.toolbar input[type=search]', 'escopo');
  await page.waitForTimeout(250);
  assert.deepEqual(await page.locator('.card .card-title').allTextContents(), ['Definir escopo']); // busca + prioridade + prazo juntos
  await page.click('.toolbar >> text=Limpar busca e filtros');
  assert.equal(await page.locator('.card').count(), 4);
  assert.equal(await page.locator('.toolbar >> text=Limpar busca e filtros').isVisible(), false);
  ok('busca (sem diferenciar acentos), filtros combinados, sem resultados e limpar tudo');

  // alterações não salvas
  await page.click('.card:has-text("Definir escopo") .card-body');
  await page.fill('dialog input[name=title]', 'Definir escopo (editado)');
  await page.keyboard.press('Escape');
  await page.waitForSelector('text=Descartar alterações?');
  await shot(page, 'descartar');
  await page.click('text=Continuar editando');
  assert.equal(await page.inputValue('dialog input[name=title]'), 'Definir escopo (editado)');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('.card:has-text("Definir escopo (editado)")');
  await page.click('.card:has-text("Definir escopo (editado)") .card-body');
  await page.fill('dialog input[name=title]', 'outra coisa');
  await page.click('dialog [aria-label=Fechar]');
  await page.click('dialog[role=alertdialog] button:has-text("Descartar alterações")');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('dialog').count(), 0);
  assert.ok(await page.locator('.card:has-text("Definir escopo (editado)")').count());
  ok('aviso ao descartar alterações; salvar pelo botão "Salvar alterações"');

  // falha ao salvar preserva o que foi digitado
  await page.click('.card:has-text("Definir escopo (editado)") .card-body');
  await page.fill('dialog input[name=title]', 'Texto que não pode se perder');
  await page.route('**/api/tasks/*', (route) => (route.request().method() === 'PATCH' ? route.abort('failed') : route.continue()));
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog .banner-error');
  assert.match(await page.locator('dialog .banner-error').innerText(), /Não foi possível salvar/);
  assert.equal(await page.inputValue('dialog input[name=title]'), 'Texto que não pode se perder');
  await shot(page, 'falha-ao-salvar');
  await page.unroute('**/api/tasks/*');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('.card:has-text("Texto que não pode se perder")');
  ok('falha de rede ao salvar: painel permanece aberto com os dados e permite tentar de novo');

  // duplicar e excluir (com confirmação)
  await page.click('.card:has-text("Texto que não pode se perder") .card-body');
  await page.click('dialog >> text=Duplicar');
  await page.waitForSelector('.card:has-text("(cópia)")');
  await page.click('.card:has-text("(cópia)") .card-body');
  await page.click('dialog >> text=Excluir');
  await page.waitForSelector('text=Excluir esta tarefa?');
  await page.click('dialog[role=alertdialog] >> text=Excluir tarefa');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.card:has-text("(cópia)")').count(), 0);
  ok('duplicar e excluir tarefa (com confirmação)');

  // editar projeto, arquivar, restaurar
  await page.click('.board-actions >> text=Configurações');
  await page.fill('dialog input[name=name]', 'Site novo 2');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('h1:has-text("Site novo 2")');
  await page.click('.board-actions >> text=Configurações');
  await shot(page, 'configuracoes');
  await page.click('dialog >> text=Arquivar projeto');
  await page.click('dialog[role=alertdialog] >> text=Arquivar projeto');
  await page.waitForURL(/#\/arquivados/);
  await page.waitForSelector('.card-project:has-text("Site novo 2")');
  await shot(page, 'arquivados');
  await page.click('.tab:has-text("Ativos")');
  await page.waitForSelector('text=Você ainda não tem projetos');
  await page.click('.tab:has-text("Arquivados")');
  await page.click('.card-project:has-text("Site novo 2") >> text=Restaurar');
  await page.waitForSelector('text=Nenhum projeto arquivado');
  await page.click('.tab:has-text("Ativos")');
  await page.waitForSelector('.card-project:has-text("Site novo 2")');
  assert.match(await page.locator('.card-project').innerText(), /1 de 4 tarefas concluídas/);
  assert.match(await page.locator('.card-project').innerText(), /Prazo: 31\/12\/2026/);
  await shot(page, 'projetos');
  ok('editar, arquivar (tarefas preservadas) e restaurar projeto; card mostra prazo e progresso');

  // busca de projeto
  await page.fill('#project-search', 'zzz');
  await page.waitForSelector('text=Nenhum projeto encontrado');
  await page.fill('#project-search', 'SITE');
  await page.waitForSelector('.card-project');
  ok('busca de projetos por nome');

  // projeto demonstrativo
  await page.fill('#project-search', '');
  await page.click('text=Criar projeto demonstrativo');
  await page.waitForSelector('h1:has-text("Projeto demonstrativo")');
  assert.ok(await page.locator('.board-title .badge-demo').count());
  await shot(page, 'demo');
  await page.click('.board-actions >> text=Configurações');
  await page.click('dialog >> text=Excluir projeto');
  await page.click('dialog[role=alertdialog] >> text=Excluir definitivamente');
  await page.waitForURL(/#\/projetos$/);
  await page.waitForSelector('.card-project');
  assert.equal(await page.locator('.card-project:has-text("demonstrativo")').count(), 0);
  ok('projeto demonstrativo opcional, identificado como exemplo e removível');

  // sair e entrar: dados permanecem
  await page.click('text=Sair');
  await page.waitForURL(/#\/entrar/);
  await page.fill('input[name=email]', 'lucas@exemplo.com');
  await page.fill('input[name=password]', 'errada-errada');
  await page.click('button[type=submit]');
  await page.waitForSelector('.banner-error');
  await page.fill('input[name=password]', 'senha-segura-1');
  await page.click('button[type=submit]');
  await page.waitForURL(/#\/projetos/);
  await page.goto(projectUrl);
  await page.waitForSelector('.card');
  assert.equal(await page.locator('.card').count(), 4);
  assert.deepEqual(await cardTitles(page, 'doing'), ['Escrever briefing', 'Revisar contrato']);
  ok('sair e entrar de novo: dados e posições recuperados');

  // recuperação de senha
  await page.click('text=Sair');
  await page.click('text=Esqueci minha senha');
  await page.waitForSelector('h1:has-text("Recuperar senha")');
  await page.fill('input[name=email]', 'lucas@exemplo.com');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=enviamos um link');
  await page.waitForTimeout(100);
  const hash = new URL(mails.at(-1).text.match(/(http\S+#\/redefinir\S+)/)[1]).hash;
  await page.goto(`${base}/${hash}`);
  await page.fill('input[name=password]', 'nova-senha-456');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Senha redefinida com sucesso');
  await page.fill('input[name=email]', 'lucas@exemplo.com');
  await page.fill('input[name=password]', 'nova-senha-456');
  await page.click('button[type=submit]');
  await page.waitForURL(/#\/projetos/);
  ok('recuperação de senha de ponta a ponta (link por e-mail → nova senha → login)');

  // outra conta não acessa
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR' });
  const other = await ctx2.newPage();
  watch(other, 'outra-conta');
  await signUp(other, 'Marina', 'marina@exemplo.com', 'senha-segura-2');
  await other.waitForSelector('text=Você ainda não tem projetos'); // carregamento terminou: lista vazia
  assert.equal(await other.locator('.card-project').count(), 0);
  assert.ok(!(await other.content()).includes('Site novo'));
  await other.goto(projectUrl);
  await other.waitForSelector('text=Projeto não encontrado');
  await shot(other, 'isolamento');
  ok('outra conta não vê nem abre o projeto de Lucas');
  await ctx2.close();
  await ctx.close();

  // ================= CELULAR =================
  console.log('Celular (390x844, toque)');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const m = await mctx.newPage();
  watch(m, 'mobile');
  await m.goto(`${base}/`);
  await m.waitForURL(/#\/entrar/);
  await m.fill('input[name=email]', 'lucas@exemplo.com');
  await m.fill('input[name=password]', 'nova-senha-456');
  await shot(m, 'm-login');
  await m.tap('button[type=submit]');
  await m.waitForURL(/#\/projetos/);
  await m.waitForSelector('.card-project');
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await shot(m, 'm-projetos');
  await m.tap('.card-project a');
  await m.waitForSelector('.card');
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await shot(m, 'm-quadro');
  await m.tap('.col-tab:has-text("Em andamento")');
  await m.waitForTimeout(700);
  assert.ok(await m.locator('.col-tab.active:has-text("Em andamento")').count());
  await shot(m, 'm-coluna-andamento');
  const box = await m.locator('.col-doing').boundingBox();
  assert.ok(box.x >= -1 && box.x < 40, `coluna deveria estar visível (x=${box.x})`);
  ok('navegação entre colunas por abas e rolagem lateral');
  await m.tap('.card:has-text("Revisar contrato") .card-body');
  await m.waitForSelector('dialog');
  await shot(m, 'm-painel');
  const dbox = await m.locator('dialog.dialog-drawer').boundingBox();
  assert.ok(dbox.width >= 389, 'painel ocupa a tela toda no celular');
  await m.selectOption('dialog select[name=column]', 'review');
  await m.tap('dialog button[type=submit]');
  await m.waitForSelector('.card-list[data-column=review] .card:has-text("Revisar contrato")');
  ok('abrir tarefa, mudar de coluna e salvar no celular');
  await m.tap('.board-actions >> text=Nova tarefa');
  await m.fill('dialog input[name=title]', 'Criada no celular');
  await m.tap('dialog button[type=submit]');
  await m.waitForSelector('.card:has-text("Criada no celular")');
  ok('criar tarefa no celular');
  const small = await m.evaluate(() => [...document.querySelectorAll('.btn, .col-tab, .card-body')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height).filter((h) => h < 36).length);
  assert.equal(small, 0, 'alvos de toque com pelo menos 36px');
  ok('alvos de toque confortáveis e sem rolagem horizontal da página');
  await mctx.close();
} catch (err) {
  console.error('\nFALHOU:', err.stack?.split('\n').slice(0, 6).join('\n') ?? err.message);
  for (const [label, p] of pages) await p.screenshot({ path: `${shots}/falha-${label}.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  db.close();
}

if (problems.length) {
  console.log('\nAvisos do navegador:');
  [...new Set(problems)].forEach((p) => console.log(' -', p));
  if (!process.exitCode) process.exitCode = 1;
} else if (!process.exitCode) {
  console.log('\nTudo certo: nenhum erro de console ou de CSP.');
}
