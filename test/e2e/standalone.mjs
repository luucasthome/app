// Verifica a versão HTML única (standalone/follow.html) abrindo o arquivo direto do disco (file://),
// exatamente como uma pessoa faria com duplo clique. Rode `npm run build:standalone` antes.
// Uso: node test/e2e/standalone.mjs [pasta-de-capturas]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cardTitles, dragCard } from './helpers.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../standalone/follow.html');
const url = pathToFileURL(file).href;
const shots = process.argv[2] || 'test-results';
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const problems = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
let step = 0;
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${shots}/s${String(++step).padStart(2, '0')}-${name}.png` }); };
const watch = (page, label) => {
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${label}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push(`[${label}] requisição externa: ${r.url()}`); });
};

try {
  console.log('HTML único (file://), computador 1280x800');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR', acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(url);
  await page.waitForSelector('text=Você ainda não tem projetos');
  assert.equal(await page.locator('text=Entrar').count(), 0); // sem tela de login
  assert.equal(await page.title(), 'Follow');
  await shot(page, 'inicio');
  ok('abre direto na lista de projetos, sem login, sem exemplos automáticos, sem requisições externas');

  await page.click('.page-head >> text=Novo projeto');
  await page.click('dialog button[type=submit]');
  assert.match(await page.locator('dialog .field-error:visible').innerText(), /nome do projeto/);
  await page.fill('dialog input[name=name]', 'Site novo');
  await page.fill('dialog input[name=due_date]', '2026-12-31');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('h1:has-text("Site novo")');
  const projectUrl = page.url();

  for (const [t, col] of [['Briefing', 'todo'], ['Escopo', 'todo'], ['Cronograma', 'todo']]) {
    await page.click('.board-actions >> text=Nova tarefa');
    await page.fill('dialog input[name=title]', t);
    await page.selectOption('dialog select[name=column]', col);
    if (t === 'Escopo') {
      await page.click('dialog .seg-high');
      await page.fill('dialog input[name=due_date]', '2020-01-15');
      await page.fill('dialog input[aria-label="Nova etapa do checklist"]', 'Ler texto');
      await page.keyboard.press('Enter');
    }
    await page.click('dialog button[type=submit]');
    await page.waitForSelector(`.card:has-text("${t}")`);
  }
  assert.match(await page.locator('.card:has-text("Escopo")').innerText(), /Atrasada · 15\/01\/2020/);
  ok('criar projeto e tarefas (só título; prioridade, prazo vencido e checklist)');

  await dragCard(page, 'Escopo', 'review');
  await dragCard(page, 'Cronograma', 'todo', 'Briefing');
  assert.deepEqual(await cardTitles(page, 'todo'), ['Cronograma', 'Briefing']);
  assert.deepEqual(await cardTitles(page, 'review'), ['Escopo']);
  await page.reload();
  await page.waitForSelector('.card');
  assert.deepEqual(await cardTitles(page, 'todo'), ['Cronograma', 'Briefing']);
  assert.deepEqual(await cardTitles(page, 'review'), ['Escopo']);
  ok('arrastar e reordenar; posições mantidas após recarregar');

  await page.fill('.toolbar input[type=search]', 'brief');
  await page.waitForTimeout(250);
  assert.deepEqual(await page.locator('.card .card-title').allTextContents(), ['Briefing']);
  await page.click('.toolbar >> text=Limpar busca e filtros');
  await page.selectOption('.toolbar select[aria-label="Filtrar por prazo"]', 'overdue');
  assert.deepEqual(await page.locator('.card .card-title').allTextContents(), ['Escopo']);
  await page.selectOption('.toolbar select[aria-label="Filtrar por prazo"]', 'all');
  ok('busca e filtros');

  // arquivar/restaurar
  await page.click('.board-actions >> text=Configurações');
  await page.click('dialog >> text=Arquivar projeto');
  await page.click('dialog[role=alertdialog] >> text=Arquivar projeto');
  await page.waitForURL(/#\/arquivados/);
  await page.click('.card-project:has-text("Site novo") >> text=Restaurar');
  await page.waitForSelector('text=Nenhum projeto arquivado');
  await page.click('.tab:has-text("Ativos")');
  await page.waitForSelector('.card-project:has-text("Site novo")');
  assert.match(await page.locator('.card-project').innerText(), /0 de 3 tarefas concluídas/);
  assert.ok(await page.locator('.local-note').isVisible());
  await shot(page, 'projetos');
  ok('arquivar e restaurar; aviso de que os dados ficam neste navegador');

  // backup: exportar, apagar tudo, importar
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.topbar >> text=Exportar')]);
  const backupPath = `${shots}/backup-teste.json`;
  await download.saveAs(backupPath);
  assert.match(download.suggestedFilename(), /^follow-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.equal(backup.app, 'follow');
  assert.equal(backup.tasks.length, 3);

  await page.click('.card-project a');
  await page.click('.board-actions >> text=Configurações');
  await page.click('dialog >> text=Excluir projeto');
  await page.click('dialog[role=alertdialog] >> text=Excluir definitivamente');
  await page.waitForSelector('text=Você ainda não tem projetos');

  await page.click('.topbar >> text=Importar');
  await page.setInputFiles('input[type=file]', backupPath);
  await page.click('dialog[role=alertdialog] button:has-text("Substituir meus dados")');
  await page.waitForSelector('.card-project:has-text("Site novo")');
  await page.goto(projectUrl);
  await page.waitForSelector('.card');
  assert.deepEqual(await cardTitles(page, 'todo'), ['Cronograma', 'Briefing']);
  assert.deepEqual(await cardTitles(page, 'review'), ['Escopo']);
  ok('exportar backup, apagar tudo e importar de volta (posições preservadas)');

  // arquivo inválido não destrói nada
  await page.click('.topbar >> text=Importar');
  await page.setInputFiles('input[type=file]', { name: 'lixo.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"outro","projects":[],"tasks":[]}') });
  await page.waitForSelector('.toast-error');
  assert.match(await page.locator('.toast-error').innerText(), /não parece ser um backup do Follow/);
  await page.goto(projectUrl);
  assert.equal(await page.locator('.card').count(), 3);
  ok('arquivo de backup inválido é recusado sem apagar os dados');

  // projeto demonstrativo
  await page.goto(url);
  await page.click('text=Criar projeto demonstrativo');
  await page.waitForSelector('h1:has-text("Projeto demonstrativo")');
  assert.ok(await page.locator('.board-title .badge-demo').count());
  await shot(page, 'demo');
  ok('projeto demonstrativo opcional e identificado');
  await ctx.close();

  // Celular
  console.log('HTML único (file://), celular 390x844');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' });
  const m = await mctx.newPage();
  watch(m, 'mobile');
  await m.goto(url);
  await m.waitForSelector('text=Você ainda não tem projetos');
  await m.tap('text=Ver projeto de exemplo');
  await m.waitForSelector('.card');
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await shot(m, 'm-quadro');
  await m.tap('.col-tab:has-text("Em andamento")');
  await m.waitForTimeout(700);
  assert.ok(await m.locator('.col-tab.active:has-text("Em andamento")').count());
  await m.tap('.card:has-text("Montar o cronograma") .card-body');
  await m.selectOption('dialog select[name=column]', 'review');
  await m.tap('dialog button[type=submit]');
  await m.waitForSelector('.card-list[data-column=review] .card:has-text("Montar o cronograma")');
  await m.tap('.back-link');
  await m.waitForSelector('.card-project');
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await shot(m, 'm-projetos');
  ok('celular: abas de coluna, mudar de coluna pelo formulário, sem rolagem horizontal');
  await mctx.close();
} catch (err) {
  console.error('\nFALHOU:', err.stack?.split('\n').slice(0, 6).join('\n') ?? err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (problems.length) {
  console.log('\nAvisos do navegador:');
  [...new Set(problems)].forEach((p) => console.log(' -', p));
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log('\nTudo certo: nenhum erro de console e nenhuma requisição externa.');
}
