import { ApiError, get, post } from '../api.js';
import { COLUMNS, PRIORITIES, columnTitle, isOverdue, priorityTitle } from '../constants.js';
import { append, banner, clear, debounce, fmtDate, h, icon, norm, toast, todayStr } from '../ui.js';
import { openProjectForm } from './projectForm.js';
import { openTaskPanel } from './taskPanel.js';

const DUE_FILTERS = [
  { id: 'all', title: 'Prazo: todos' },
  { id: 'overdue', title: 'Prazo: atrasadas' },
  { id: 'today', title: 'Prazo: para hoje' },
  { id: 'none', title: 'Prazo: sem prazo' },
];

function matches(t, f, today) {
  if (f.q && !norm(t.title).includes(norm(f.q))) return false;
  if (f.priority !== 'all' && t.priority !== f.priority) return false;
  if (f.due === 'overdue') return isOverdue(t, today);
  if (f.due === 'today') return t.due_date === today;
  if (f.due === 'none') return !t.due_date;
  return true;
}

export async function boardView(main, { projectId, go }) {
  let alive = true;
  let project = null;
  let tasks = [];
  const filters = { q: '', priority: 'all', due: 'all' };
  let sortables = [];
  let dragging = false;
  let pending = 0; // movimentos em andamento no servidor
  let moveChain = Promise.resolve();

  const page = h('div', { class: 'page page-board' }, h('div', { class: 'board-loading', 'aria-busy': 'true' },
    h('div', { class: 'sk sk-line sk-w40' }), h('div', { class: 'sk sk-line sk-w60' }),
    h('div', { class: 'board-skeleton' }, ...COLUMNS.map(() => h('div', { class: 'sk sk-col' })))));
  main.append(page);

  try {
    const r = await get(`/projects/${projectId}`);
    if (!alive) return () => {};
    project = r.project;
    tasks = r.tasks;
  } catch (err) {
    const notFound = err instanceof ApiError && err.status === 404;
    clear(page).append(h('div', { class: 'empty' },
      banner('error', notFound ? 'Projeto não encontrado. Ele pode ter sido excluído.' : err.message),
      notFound
        ? h('a', { class: 'btn btn-primary', href: '#/projetos' }, 'Voltar aos projetos')
        : h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Tentar novamente')));
    return () => {};
  }
  document.title = `${project.name} — Projetos`;

  const isArchived = () => project.status === 'archived';

  // ----- Cabeçalho -----
  const head = h('div', { class: 'board-head' });
  function renderHead() {
    const done = tasks.filter((t) => t.column === 'done').length;
    const total = tasks.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const today = todayStr();
    const late = project.due_date && project.due_date < today && done < total;
    append(clear(head), [
      h('a', { class: 'back-link', href: isArchived() ? '#/arquivados' : '#/projetos' }, icon('back'), isArchived() ? 'Arquivados' : 'Projetos'),
      h('div', { class: 'board-title-row' },
        h('div', { class: 'board-title' },
          h('h1', null, project.name),
          project.is_demo ? h('span', { class: 'badge badge-demo' }, 'Exemplo') : null,
          isArchived() ? h('span', { class: 'badge badge-muted' }, 'Arquivado') : null),
        h('div', { class: 'board-actions' },
          isArchived() ? null : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => newTask('todo') }, icon('plus'), 'Nova tarefa'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: openSettings }, icon('settings'), 'Configurações'))),
      project.description ? h('p', { class: 'board-desc' }, project.description) : null,
      h('div', { class: 'board-meta' },
        project.due_date
          ? h('span', { class: `meta-chip ${late ? 'is-overdue' : ''}` }, icon(late ? 'alert' : 'calendar', 16), late ? `Prazo vencido em ${fmtDate(project.due_date)}` : `Prazo: ${fmtDate(project.due_date)}`)
          : null,
        h('div', { class: 'progress-inline' },
          h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': 'Progresso do projeto' },
            h('div', { class: 'progress-fill', style: { width: `${pct}%` } })),
          h('span', { class: 'progress-text' }, total ? `${done} de ${total} concluídas · ${pct}%` : 'Nenhuma tarefa ainda'))),
    ]);
  }

  // ----- Barra de busca e filtros -----
  const searchInput = h('input', { type: 'search', placeholder: 'Buscar tarefa pelo título', autocomplete: 'off', 'aria-label': 'Buscar tarefa pelo título' });
  const prioSelect = h('select', { 'aria-label': 'Filtrar por prioridade' },
    h('option', { value: 'all' }, 'Prioridade: todas'), ...PRIORITIES.map((p) => h('option', { value: p.id }, `Prioridade: ${p.title.toLowerCase()}`)));
  const dueSelect = h('select', { 'aria-label': 'Filtrar por prazo' }, ...DUE_FILTERS.map((d) => h('option', { value: d.id }, d.title)));
  const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost', hidden: true, onclick: resetFilters }, icon('x', 16), 'Limpar busca e filtros');
  const toolbar = h('div', { class: 'toolbar' }, h('div', { class: 'searchbox' }, icon('search'), searchInput), prioSelect, dueSelect, clearBtn);

  const filtersActive = () => !!filters.q.trim() || filters.priority !== 'all' || filters.due !== 'all';
  function resetFilters() {
    filters.q = ''; filters.priority = 'all'; filters.due = 'all';
    searchInput.value = ''; prioSelect.value = 'all'; dueSelect.value = 'all';
    renderBoard();
    searchInput.focus();
  }
  searchInput.addEventListener('input', debounce(() => { filters.q = searchInput.value; renderBoard(); }, 120));
  prioSelect.addEventListener('change', () => { filters.priority = prioSelect.value; renderBoard(); });
  dueSelect.addEventListener('change', () => { filters.due = dueSelect.value; renderBoard(); });

  // ----- Quadro -----
  const colTabs = h('div', { class: 'col-tabs', role: 'tablist', 'aria-label': 'Colunas do quadro' });
  const boardEl = h('div', { class: 'board' });
  const stateEl = h('div');
  let activeCol = 0;

  function chips(t, today) {
    const out = [];
    out.push(h('span', { class: `chip prio-${t.priority}` }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'sr-only' }, 'Prioridade '), priorityTitle(t.priority)));
    if (t.due_date) {
      const late = isOverdue(t, today);
      const isToday = t.due_date === today && t.column !== 'done';
      out.push(h('span', { class: `chip due ${late ? 'is-overdue' : isToday ? 'is-today' : ''}` },
        icon(late ? 'alert' : 'calendar', 14), late ? `Atrasada · ${fmtDate(t.due_date)}` : isToday ? `Hoje · ${fmtDate(t.due_date)}` : fmtDate(t.due_date)));
    }
    if (t.checklist.length) {
      const done = t.checklist.filter((i) => i.done).length;
      out.push(h('span', { class: 'chip check' }, icon('checklist', 14), `${done}/${t.checklist.length}`, h('span', { class: 'sr-only' }, ' etapas concluídas')));
    }
    return out;
  }

  function card(t, today) {
    const open = () => { if (!dragging) openTask(t); };
    return h('li', { class: 'card', dataset: { id: t.id } },
      h('div', { class: 'card-body', role: 'button', tabindex: '0', onclick: open,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
        h('p', { class: 'card-title' }, t.title),
        h('div', { class: 'card-meta' }, chips(t, today))));
  }

  function renderBoard() {
    sortables.forEach((s) => s.destroy());
    sortables = [];
    const today = todayStr();
    const shownTasks = tasks.filter((t) => matches(t, filters, today));
    clearBtn.hidden = !filtersActive();
    renderHead();
    clear(stateEl);
    clear(colTabs);
    clear(boardEl);

    if (!tasks.length) {
      boardEl.hidden = true; colTabs.hidden = true;
      stateEl.append(h('div', { class: 'empty' }, icon('checklist', 32), h('h2', null, 'Este projeto ainda não tem tarefas'),
        h('p', { class: 'muted' }, isArchived() ? 'Restaure o projeto em Configurações para adicionar tarefas.' : 'Comece pela primeira: basta um título. O restante você preenche quando tiver.'),
        isArchived() ? null : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => newTask('todo') }, icon('plus'), 'Criar primeira tarefa')));
      return;
    }
    if (!shownTasks.length) {
      boardEl.hidden = true; colTabs.hidden = true;
      stateEl.append(h('div', { class: 'empty' }, icon('search', 32), h('h2', null, 'Nenhuma tarefa encontrada'),
        h('p', { class: 'muted' }, 'Nenhuma tarefa combina com a busca e os filtros atuais. Ajuste os termos ou limpe tudo para ver o quadro completo.'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: resetFilters }, 'Limpar busca e filtros')));
      return;
    }
    boardEl.hidden = false; colTabs.hidden = false;

    COLUMNS.forEach((c, idx) => {
      const all = tasks.filter((t) => t.column === c.id);
      const shown = shownTasks.filter((t) => t.column === c.id);
      const countText = filtersActive() ? `${shown.length}/${all.length}` : String(all.length);
      const list = h('ul', { class: 'card-list', dataset: { column: c.id }, 'aria-label': `Tarefas em ${c.title}` }, shown.map((t) => card(t, today)));
      if (!shown.length) {
        list.append(h('li', { class: 'col-empty', 'aria-hidden': 'false' }, filtersActive() && all.length ? 'Nenhuma tarefa com os filtros atuais.' : isArchived() ? 'Sem tarefas.' : 'Nenhuma tarefa aqui. Arraste um cartão para cá ou crie uma nova.'));
      }
      boardEl.append(h('section', { class: `column col-${c.id}`, dataset: { col: String(idx) }, 'aria-labelledby': `col-title-${c.id}` },
        h('header', { class: 'column-head' },
          h('h2', { id: `col-title-${c.id}` }, c.title),
          h('span', { class: 'count', 'aria-label': `${all.length} ${all.length === 1 ? 'tarefa' : 'tarefas'}` }, countText),
          isArchived() ? null : h('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': `Adicionar tarefa em ${c.title}`, title: `Adicionar em ${c.title}`, onclick: () => newTask(c.id) }, icon('plus'))),
        list));
      colTabs.append(h('button', { type: 'button', role: 'tab', class: `col-tab ${idx === activeCol ? 'active' : ''}`, 'aria-selected': String(idx === activeCol), dataset: { col: String(idx) },
        onclick: () => scrollToColumn(idx) }, c.title, ' ', h('span', { class: 'count' }, countText)));
      if (!isArchived()) sortables.push(makeSortable(list));
    });
  }

  function makeSortable(list) {
    return new Sortable(list, {
      group: 'tasks',
      draggable: '.card',
      animation: 150,
      forceFallback: true, // mesmo comportamento de mouse e toque em todos os navegadores
      fallbackTolerance: 4,
      delay: 220, // no toque, é preciso pressionar um instante: assim a rolagem da tela continua funcionando
      delayOnTouchOnly: true,
      touchStartThreshold: 8,
      ghostClass: 'card-ghost',
      chosenClass: 'card-chosen',
      dragClass: 'card-drag',
      fallbackClass: 'card-fallback',
      scroll: true,
      scrollSensitivity: 60,
      onStart: () => { dragging = true; document.body.classList.add('is-dragging'); },
      onEnd: (evt) => {
        document.body.classList.remove('is-dragging');
        setTimeout(() => { dragging = false; }, 80);
        const id = evt.item.dataset.id;
        const column = evt.to.dataset.column;
        const next = evt.item.nextElementSibling;
        const beforeId = next?.classList.contains('card') ? next.dataset.id : null;
        if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
        requestAnimationFrame(() => moveTask(id, column, beforeId));
      },
    });
  }

  function moveLocal(id, column, beforeId) {
    const t = tasks.find((x) => x.id === id);
    const rest = tasks.filter((x) => x.id !== id);
    const moved = { ...t, column };
    let at = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1;
    if (at === -1) {
      at = rest.reduce((last, x, i) => (x.column === column ? i : last), -1) + 1;
      if (at === 0) at = rest.length;
    }
    rest.splice(at, 0, moved);
    tasks = rest;
  }

  // Movimento otimista: o cartão já aparece no lugar novo; se o servidor recusar, a posição antiga volta.
  function moveTask(id, column, beforeId) {
    const moved = tasks.find((x) => x.id === id);
    moveLocal(id, column, beforeId);
    renderBoard();
    pending += 1;
    moveChain = moveChain.then(async () => {
      try {
        const r = await post(`/tasks/${id}/move`, { column, before_id: beforeId });
        if (pending === 1 && alive) { tasks = r.tasks; renderBoard(); }
        if (moved.column !== column) toast(`Movida para “${columnTitle(column)}”.`, 'success');
      } catch (err) {
        toast(`Não foi possível mover a tarefa: ${err.message} A posição anterior foi restaurada.`, 'error');
        try { tasks = (await get(`/projects/${projectId}`)).tasks; } catch { /* mantém o estado atual */ }
        if (alive) renderBoard();
      } finally {
        pending -= 1;
      }
    });
  }

  function scrollToColumn(idx) {
    boardEl.children[idx]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }
  let ticking = false;
  boardEl.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const first = boardEl.children[0];
      if (!first) return;
      const step = first.getBoundingClientRect().width + 12;
      const idx = Math.max(0, Math.min(COLUMNS.length - 1, Math.round(boardEl.scrollLeft / step)));
      if (idx !== activeCol) {
        activeCol = idx;
        [...colTabs.children].forEach((b, i) => { b.classList.toggle('active', i === idx); b.setAttribute('aria-selected', String(i === idx)); });
      }
    });
  }, { passive: true });

  // ----- Ações -----
  const applyResult = (r) => { tasks = r.tasks; renderBoard(); };

  function newTask(column) {
    openTaskPanel({ projectId, column, onSaved: applyResult });
  }
  function openTask(t) {
    openTaskPanel({ projectId, task: t, readOnly: isArchived(), onSaved: applyResult, onDuplicated: applyResult, onDeleted: (id) => { tasks = tasks.filter((x) => x.id !== id); renderBoard(); } });
  }
  function openSettings() {
    openProjectForm({
      project,
      onSaved: (p) => { project = p; document.title = `${p.name} — Projetos`; renderBoard(); },
      onArchiveChange: (p) => { if (p.status === 'archived') go('#/arquivados'); else { project = p; renderBoard(); } },
      onDeleted: () => go('#/projetos'),
    });
  }

  append(clear(page), [
    head,
    isArchived() ? banner('info', 'Este projeto está arquivado e não pode ser alterado. Abra “Configurações” para restaurá-lo.') : null,
    toolbar, colTabs, stateEl, boardEl,
  ]);
  renderBoard();

  return () => {
    alive = false;
    sortables.forEach((s) => s.destroy());
    document.title = 'Projetos';
    document.querySelectorAll('dialog').forEach((d) => d.remove());
  };
}
