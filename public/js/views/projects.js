import { ApiError, get, patch, post } from '../api.js';
import { banner, clear, debounce, fmtDate, h, icon, newId, norm, toast, todayStr, withBusy } from '../ui.js';
import { openProjectForm } from './projectForm.js';

function skeleton() {
  return h('div', { class: 'project-grid', 'aria-busy': 'true', 'aria-label': 'Carregando projetos' },
    ...[1, 2, 3].map(() => h('div', { class: 'card-project skeleton-card' }, h('div', { class: 'sk sk-line sk-w60' }), h('div', { class: 'sk sk-line sk-w40' }), h('div', { class: 'sk sk-bar' }))));
}

function progressBlock(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': 'Progresso do projeto' },
    h('div', { class: 'progress-fill', style: { width: `${pct}%` } }));
  const text = total ? `${done} de ${total} ${total === 1 ? 'tarefa concluída' : 'tarefas concluídas'}` : 'Nenhuma tarefa ainda';
  return h('div', { class: 'progress-block' }, bar, h('p', { class: 'progress-text' }, text, total ? h('span', { class: 'pct' }, ` · ${pct}%`) : null));
}

export async function projectsView(main, { archived }) {
  let alive = true;
  let projects = [];
  let counts = { active: 0, archived: 0 };
  let query = '';

  const title = h('h1', null, archived ? 'Projetos arquivados' : 'Projetos');
  const newBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openProjectForm({ onSaved: (p) => { location.hash = `#/projeto/${p.id}`; } }) }, icon('plus'), 'Novo projeto');
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Situação dos projetos' });
  const searchInput = h('input', { type: 'search', id: 'project-search', placeholder: 'Buscar projeto pelo nome', autocomplete: 'off', 'aria-label': 'Buscar projeto pelo nome' });
  const content = h('div', { class: 'projects-content' });
  const search = h('div', { class: 'searchbox' }, icon('search'), searchInput);

  main.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, title, archived ? null : newBtn),
    tabs, search, content));

  const renderTabs = () => clear(tabs).append(
    h('a', { href: '#/projetos', class: `tab ${archived ? '' : 'active'}`, 'aria-current': archived ? null : 'page' }, 'Ativos ', h('span', { class: 'count' }, counts.active)),
    h('a', { href: '#/arquivados', class: `tab ${archived ? 'active' : ''}`, 'aria-current': archived ? 'page' : null }, 'Arquivados ', h('span', { class: 'count' }, counts.archived)));

  function emptyState() {
    if (archived) {
      return h('div', { class: 'empty' }, icon('archive', 32), h('h2', null, 'Nenhum projeto arquivado'),
        h('p', { class: 'muted' }, 'Quando você arquivar um projeto, ele aparece aqui com todas as tarefas preservadas e pode ser restaurado a qualquer momento.'),
        h('a', { href: '#/projetos', class: 'btn btn-secondary' }, 'Ver projetos ativos'));
    }
    return h('div', { class: 'empty' }, icon('folder', 32), h('h2', null, 'Você ainda não tem projetos'),
      h('p', { class: 'muted' }, 'Crie o primeiro para organizar suas tarefas em um quadro Kanban. Se preferir conhecer antes, veja um projeto de exemplo com tarefas fictícias.'),
      h('div', { class: 'row wrap center' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => newBtn.click() }, icon('plus'), 'Criar meu primeiro projeto'),
        demoButton('btn btn-secondary', 'Ver projeto de exemplo')));
  }

  function demoButton(cls, label) {
    const btn = h('button', { type: 'button', class: cls }, label);
    const draftId = newId();
    btn.addEventListener('click', () => withBusy(btn, 'Criando exemplo…', async () => {
      try {
        const r = await post('/projects/demo', { id: draftId, today: todayStr() });
        location.hash = `#/projeto/${r.project.id}`;
      } catch (err) {
        toast(`Não foi possível criar o exemplo. ${err.message}`, 'error');
      }
    }));
    return btn;
  }

  function card(p) {
    const overdue = p.due_date && p.due_date < todayStr() && p.done_count < p.task_count;
    const link = h('a', { class: 'project-link', href: `#/projeto/${p.id}` },
      h('div', { class: 'project-title' }, h('h2', null, p.name), p.is_demo ? h('span', { class: 'badge badge-demo' }, 'Exemplo') : null),
      p.due_date
        ? h('p', { class: `project-due ${overdue ? 'is-overdue' : ''}` }, icon(overdue ? 'alert' : 'calendar', 16), overdue ? `Prazo vencido em ${fmtDate(p.due_date)}` : `Prazo: ${fmtDate(p.due_date)}`)
        : h('p', { class: 'project-due muted' }, 'Sem prazo definido'),
      progressBlock(p.done_count, p.task_count));
    const restore = archived ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: async (e) => {
      await withBusy(e.currentTarget, 'Restaurando…', async () => {
        try {
          await patch(`/projects/${p.id}`, { status: 'active' });
          toast(`“${p.name}” foi restaurado.`, 'success');
          await load();
        } catch (err) { toast(`Não foi possível restaurar. ${err.message}`, 'error'); }
      });
    } }, icon('restore'), 'Restaurar') : null;
    return h('article', { class: 'card-project' }, link, restore ? h('div', { class: 'card-actions' }, restore) : null);
  }

  function renderList() {
    renderTabs();
    clear(content);
    const q = norm(query.trim());
    const shown = q ? projects.filter((p) => norm(p.name).includes(q)) : projects;
    search.hidden = !projects.length;
    if (!projects.length) return content.append(emptyState());
    if (!shown.length) {
      return content.append(h('div', { class: 'empty' }, icon('search', 32), h('h2', null, 'Nenhum projeto encontrado'),
        h('p', { class: 'muted' }, `Nada com “${query.trim()}” no nome. Confira a digitação ou limpe a busca para ver todos.`),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { searchInput.value = ''; query = ''; renderList(); searchInput.focus(); } }, 'Limpar busca')));
    }
    content.append(h('div', { class: 'project-grid' }, shown.map(card)));
    if (!archived && !projects.some((p) => p.is_demo)) {
      content.append(h('p', { class: 'demo-hint muted' }, 'Quer ver o app com dados de exemplo? ', demoButton('link-btn', 'Criar projeto demonstrativo'), '.'));
    }
  }

  async function load() {
    if (!alive) return;
    clear(content).append(skeleton());
    renderTabs();
    try {
      const r = await get(`/projects?status=${archived ? 'archived' : 'active'}`);
      if (!alive) return;
      projects = r.projects;
      counts = r.counts;
      renderList();
    } catch (err) {
      if (!alive) return;
      search.hidden = true;
      clear(content).append(h('div', { class: 'empty' }, banner('error', err instanceof ApiError ? err.message : 'Erro inesperado.'),
        h('p', { class: 'muted' }, 'Seus projetos continuam salvos. Verifique a conexão e tente de novo.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: load }, 'Tentar novamente')));
    }
  }

  searchInput.addEventListener('input', debounce(() => { query = searchInput.value; renderList(); }, 120));
  await load();
  return () => { alive = false; };
}
