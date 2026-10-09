import { ApiError, del, patch, post } from '../api.js';
import { COLUMNS, PRIORITIES } from '../constants.js';
import { banner, clear, confirmDialog, createModal, field, fmtDateTime, h, icon, newId, showFieldErrors, toast, weekday, fmtDate, withBusy } from '../ui.js';

// Painel lateral (no celular, tela cheia) para criar, consultar e editar uma tarefa sem sair do quadro.
export function openTaskPanel({ projectId, task, column = 'todo', readOnly = false, onSaved, onDuplicated, onDeleted }) {
  const editing = !!task;
  const draftId = newId(); // mesmo id em todas as tentativas de criar: cliques repetidos não duplicam
  let priority = task?.priority ?? 'medium';
  let items = (task?.checklist ?? []).map((i) => ({ ...i }));

  const f = {
    title: field({ label: 'Título', name: 'title', value: task?.title, required: true, attrs: { maxlength: 200, autocomplete: 'off', placeholder: 'O que precisa ser feito?' } }),
    column: field({
      label: 'Coluna', name: 'column', tag: 'select', value: task?.column ?? column,
      children: COLUMNS.map((c) => h('option', { value: c.id }, c.title)),
    }),
    due_date: field({ label: 'Prazo', name: 'due_date', type: 'date', value: task?.due_date ?? '', hint: ' ' }),
    description: field({ label: 'Descrição', name: 'description', tag: 'textarea', value: task?.description, attrs: { maxlength: 5000, rows: 4 } }),
  };
  const dueHint = f.due_date.wrap.querySelector('.field-hint');
  const updateDueHint = () => {
    const v = f.due_date.control.value;
    dueHint.textContent = v ? `${weekday(v)}, ${fmtDate(v)}` : 'Opcional.';
  };
  updateDueHint();

  // Prioridade: grupo de opções com rótulo de texto (tocável no celular, navegável por teclado).
  const prioName = `prio-${Math.random().toString(36).slice(2, 7)}`;
  const prioGroup = h('fieldset', { class: 'field segmented' },
    h('legend', null, 'Prioridade'),
    h('div', { class: 'segmented-options' }, PRIORITIES.map((p) => h('label', { class: `seg seg-${p.id}` },
      h('input', { type: 'radio', name: prioName, value: p.id, checked: p.id === priority, onchange: () => { priority = p.id; } }),
      h('span', null, p.title)))));

  // Checklist
  const listEl = h('ul', { class: 'check-list' });
  const addInput = h('input', { type: 'text', maxlength: 200, placeholder: 'Nova etapa', 'aria-label': 'Nova etapa do checklist', autocomplete: 'off' });
  const progressEl = h('span', { class: 'muted check-progress' });
  const updateProgress = () => {
    const done = items.filter((i) => i.done && i.text.trim()).length;
    const total = items.filter((i) => i.text.trim()).length;
    progressEl.textContent = total ? `${done}/${total} concluídas` : '';
  };
  const addItem = () => {
    const text = addInput.value.trim();
    if (!text) return;
    items.push({ id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text, done: false });
    addInput.value = '';
    renderItems();
    addInput.focus();
    modal.form.dispatchEvent(new Event('input', { bubbles: true }));
  };
  function renderItems() {
    clear(listEl).append(...items.map((it, i) => h('li', { class: 'check-item' },
      h('input', { type: 'checkbox', checked: it.done, 'aria-label': `Concluir etapa: ${it.text}`, onchange: (e) => { it.done = e.target.checked; updateProgress(); } }),
      h('input', { type: 'text', class: 'check-text', value: it.text, maxlength: 200, 'aria-label': `Etapa ${i + 1}`, oninput: (e) => { it.text = e.target.value; updateProgress(); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addInput.focus(); } } }),
      h('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': `Remover etapa: ${it.text}`, onclick: () => {
        items = items.filter((x) => x !== it);
        renderItems();
        modal.form.dispatchEvent(new Event('input', { bubbles: true }));
      } }, icon('x', 16)))));
    updateProgress();
  }
  addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
  const addBtn = h('button', { type: 'button', class: 'btn btn-secondary', onclick: addItem }, icon('plus', 16), 'Adicionar');
  const checklistBox = h('section', { class: 'field' },
    h('div', { class: 'row between' }, h('h3', { class: 'label-like' }, 'Checklist'), progressEl),
    listEl, h('div', { class: 'check-add' }, addInput, addBtn));

  const snapshot = () => JSON.stringify([
    f.title.control.value.trim(), f.description.control.value.trim(), f.column.control.value, priority, f.due_date.control.value,
    items.map((i) => [i.text.trim(), i.done]).filter(([t]) => t), addInput.value.trim(),
  ]);
  const start = snapshot();
  const modal = createModal({
    title: readOnly ? 'Detalhes da tarefa' : editing ? 'Editar tarefa' : 'Nova tarefa',
    variant: 'drawer',
    isDirty: () => !readOnly && snapshot() !== start,
  });
  const errorSlot = h('div');
  const fieldsWrap = h('fieldset', { class: 'plain-fieldset', disabled: readOnly },
    f.title.wrap,
    h('div', { class: 'grid-2' }, f.column.wrap, f.due_date.wrap),
    prioGroup, f.description.wrap, checklistBox);
  modal.body.append(errorSlot, fieldsWrap);
  if (editing) modal.body.append(h('p', { class: 'meta-line' }, `Criada em ${fmtDateTime(task.created_at)} · Atualizada em ${fmtDateTime(task.updated_at)}`));
  renderItems();

  const clearDue = h('button', { type: 'button', class: 'link-btn', onclick: () => { f.due_date.control.value = ''; updateDueHint(); modal.form.dispatchEvent(new Event('input', { bubbles: true })); } }, 'Remover prazo');
  f.due_date.wrap.append(clearDue);
  const syncDue = () => { clearDue.hidden = !f.due_date.control.value || readOnly; updateDueHint(); };
  f.due_date.control.addEventListener('input', syncDue);
  f.due_date.control.addEventListener('change', syncDue);
  syncDue();

  // Rodapé
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, editing ? 'Salvar alterações' : 'Criar tarefa');
  const cancel = h('button', { type: 'button', class: 'btn btn-secondary', onclick: modal.requestClose }, readOnly ? 'Fechar' : 'Cancelar');
  const left = h('div', { class: 'footer-left' });
  if (editing && !readOnly) {
    const dup = h('button', { type: 'button', class: 'btn btn-ghost', title: 'Salve ou descarte as alterações para duplicar' }, icon('copy'), 'Duplicar');
    dup.addEventListener('click', () => withBusy(dup, 'Duplicando…', async () => {
      try {
        const r = await post(`/tasks/${task.id}/duplicate`, { id: newId() });
        modal.close();
        toast('Tarefa duplicada.', 'success');
        onDuplicated?.(r);
      } catch (err) {
        clear(errorSlot).append(banner('error', `Não foi possível duplicar. ${err.message}`));
      }
    }));
    const remove = h('button', { type: 'button', class: 'btn btn-ghost btn-danger-text' }, icon('trash'), 'Excluir');
    remove.addEventListener('click', async () => {
      if (!(await confirmDialog({
        title: 'Excluir esta tarefa?',
        message: `“${task.title}” será apagada de forma permanente.`,
        confirmLabel: 'Excluir tarefa',
        danger: true,
      }))) return;
      try {
        await del(`/tasks/${task.id}`);
        modal.close();
        toast('Tarefa excluída.', 'success');
        onDeleted?.(task.id);
      } catch (err) {
        clear(errorSlot).append(banner('error', `Não foi possível excluir. ${err.message}`));
      }
    });
    left.append(dup, remove);
    const syncDup = () => { dup.disabled = snapshot() !== start; };
    modal.form.addEventListener('input', syncDup);
    modal.form.addEventListener('change', syncDup);
  }
  modal.footer.append(left, h('div', { class: 'footer-right' }, cancel, readOnly ? null : submit));
  if (!editing && !readOnly) f.title.control.focus();

  modal.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (readOnly) return;
    clear(errorSlot);
    Object.values(f).forEach((x) => x.setError(null));
    if (!f.title.control.value.trim()) {
      f.title.setError('Dê um título à tarefa para salvar.');
      f.title.control.focus();
      return;
    }
    addItem(); // texto digitado e ainda não adicionado entra no checklist
    const data = {
      title: f.title.control.value,
      description: f.description.control.value,
      column: f.column.control.value,
      priority,
      due_date: f.due_date.control.value || null,
      checklist: items.map(({ id, text, done }) => ({ id, text, done })),
    };
    await withBusy(submit, 'Salvando…', async () => {
      try {
        const r = editing ? await patch(`/tasks/${task.id}`, data) : await post(`/projects/${projectId}/tasks`, { id: draftId, ...data });
        modal.close();
        toast(editing ? 'Tarefa atualizada.' : 'Tarefa criada.', 'success');
        onSaved?.(r);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        const shown = showFieldErrors(f, err.fields);
        // O painel continua aberto com tudo o que foi digitado.
        if (!shown || err.fields?.checklist || err.fields?.priority) {
          errorSlot.append(banner('error', `Não foi possível salvar a tarefa. ${err.fields?.checklist ?? err.fields?.priority ?? err.message} Suas informações continuam aqui — tente novamente.`));
        }
      }
    });
  });
}
