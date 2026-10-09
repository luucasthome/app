import { get, post, setUnauthorizedHandler } from './api.js';
import { boardView } from './views/board.js';
import { forgotView, loginView, registerView, resetView } from './views/auth.js';
import { projectsView } from './views/projects.js';
import { banner, clear, h, icon } from './ui.js';

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

function shell() {
  const main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
  const header = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/projetos', 'aria-label': 'Follow — página inicial' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('span', { class: 'brand-name' }, 'Follow')),
    h('div', { class: 'topbar-user' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, (user.name.trim()[0] ?? '?').toUpperCase()),
      h('span', { class: 'user-name', title: user.email }, user.name),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: logout }, icon('logout'), h('span', null, 'Sair'))));
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
