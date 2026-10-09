import { LOCAL, get, post, setUnauthorizedHandler } from './api.js';
import { boardView } from './views/board.js';
import { forgotView, loginView, registerView, resetView } from './views/auth.js';
import { projectsView } from './views/projects.js';
import { banner, clear, confirmDialog, h, icon, toast } from './ui.js';

const app = document.getElementById('app');
let user = null;
let cleanup = null;
let flash = null; // aviso mostrado uma vez na próxima tela de login

const PUBLIC_ROUTES = new Set(['entrar', 'cadastro', 'recuperar', 'redefinir']);

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] ?? '', arg: parts[1], params: new URLSearchParams(query) };
}

const go = (hash) => { location.hash = hash; };

function setUser(u) { user = u; }

async function logout() {
  try { await post('/auth/logout', {}); } catch { /* mesmo com falha de rede, volta ao login */ }
  setUser(null);
  go('#/entrar');
}

// Versão HTML única: sem conta; o menu oferece backup, já que os dados vivem só neste navegador.
async function exportBackup() {
  const { exportData } = await import('./local-api.js');
  const data = exportData();
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const link = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `follow-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  toast('Backup salvo. Guarde o arquivo em um lugar seguro.', 'success');
}

function importBackup() {
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    try {
      const { parseBackup, restoreBackup } = await import('./local-api.js');
      const parsed = parseBackup(JSON.parse(await file.text())); // valida antes de perguntar qualquer coisa
      if (!(await confirmDialog({
        title: 'Restaurar este backup?',
        message: `O arquivo tem ${parsed.projects.length} projeto(s) e ${parsed.tasks.length} tarefa(s). Todos os projetos e tarefas atuais deste navegador serão substituídos. Se tiver dúvida, exporte um backup antes.`,
        confirmLabel: 'Substituir meus dados',
        danger: true,
      }))) return;
      const r = restoreBackup(parsed);
      toast(`Backup restaurado: ${r.projects} projeto(s) e ${r.tasks} tarefa(s).`, 'success');
      if (location.hash === '#/projetos') render(); else go('#/projetos');
    } catch (err) {
      toast(err instanceof SyntaxError ? 'Este arquivo não é um backup válido do Follow.' : err.message, 'error');
    }
  });
  document.body.append(input);
  input.click();
}

function shell() {
  const main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
  const userArea = LOCAL
    ? h('div', { class: 'topbar-user' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Salvar uma cópia dos seus dados em um arquivo', onclick: exportBackup }, icon('download'), h('span', null, 'Exportar')),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Restaurar dados de um arquivo de backup', onclick: importBackup }, icon('upload'), h('span', null, 'Importar')))
    : h('div', { class: 'topbar-user' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, (user.name.trim()[0] ?? '?').toUpperCase()),
      h('span', { class: 'user-name', title: user.email }, user.name),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: logout }, icon('logout'), h('span', null, 'Sair')));
  const header = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/projetos', 'aria-label': 'Follow — página inicial' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('span', { class: 'brand-name' }, 'Follow')),
    userArea);
  clear(app).append(h('a', { class: 'skip-link', href: '#main' }, 'Ir para o conteúdo'), header, main);
  return main;
}

async function render() {
  cleanup?.();
  cleanup = null;
  const route = parseHash();

  // O link de recuperação funciona mesmo com outra sessão aberta neste navegador.
  if (route.name === 'redefinir') {
    return resetView(app, { token: route.params.get('token'), onDone: (msg) => { setUser(null); flash = msg; go('#/entrar'); } });
  }
  if (!user && !PUBLIC_ROUTES.has(route.name)) return go('#/entrar');
  if (user && PUBLIC_ROUTES.has(route.name)) return go('#/projetos');

  if (!user) {
    const onAuthenticated = (u) => { setUser(u); go('#/projetos'); };
    if (route.name === 'cadastro') return registerView(app, { onAuthenticated });
    if (route.name === 'recuperar') return forgotView(app);
    const notice = flash;
    flash = null;
    return loginView(app, { onAuthenticated, notice });
  }

  const main = shell();
  const ctx = { user, go };
  if (route.name === 'projeto' && route.arg) cleanup = await boardView(main, { ...ctx, projectId: route.arg });
  else if (route.name === 'arquivados') cleanup = await projectsView(main, { ...ctx, archived: true });
  else if (route.name === 'projetos' || route.name === '') cleanup = await projectsView(main, { ...ctx, archived: false });
  else go('#/projetos');
}

setUnauthorizedHandler(() => {
  if (!user) return;
  setUser(null);
  flash = 'Sua sessão expirou. Entre novamente para continuar.';
  go('#/entrar');
});

window.addEventListener('hashchange', render);

(async function boot() {
  clear(app).append(h('div', { class: 'splash' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Carregando' })));
  try {
    user = (await get('/auth/me')).user;
  } catch (err) {
    if (err.status !== 401) {
      clear(app).append(h('main', { class: 'auth-page' }, h('div', { class: 'auth-card' },
        h('h1', null, 'Não foi possível carregar'), banner('error', err.message),
        h('button', { class: 'btn btn-primary btn-block', onclick: () => location.reload() }, 'Tentar novamente'))));
      return;
    }
  }
  render();
})();
