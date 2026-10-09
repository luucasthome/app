import { ApiError, del, patch, post } from '../api.js';
import { banner, clear, confirmDialog, createModal, field, h, icon, newId, showFieldErrors, toast, fmtDateTime, withBusy } from '../ui.js';

// Cria (sem `project`) ou edita (com `project`) um projeto. Em edição, também oferece arquivar/restaurar/excluir.
export function openProjectForm({ project, onSaved, onArchiveChange, onDeleted }) {
  const editing = !!project;
  const draftId = newId(); // o mesmo id vai em todas as tentativas: repetir o envio não duplica o projeto
  const initial = () => JSON.stringify([f.name.control.value.trim(), f.description.control.value.trim(), f.due_date.control.value]);

  const f = {
    name: field({ label: 'Nome do projeto', name: 'name', value: project?.name, required: true, attrs: { maxlength: 120, autocomplete: 'off', placeholder: 'Ex.: Lançamento do site' } }),
    description: field({ label: 'Descrição', name: 'description', tag: 'textarea', value: project?.description, hint: 'Opcional.', attrs: { maxlength: 2000 } }),
    due_date: field({ label: 'Prazo do projeto', name: 'due_date', type: 'date', value: project?.due_date ?? '', hint: 'Opcional.' }),
  };
  const start = initial();
  const modal = createModal({ title: editing ? 'Configurações do projeto' : 'Novo projeto', isDirty: () => initial() !== start });
  const errorSlot = h('div');
  modal.body.append(errorSlot, f.name.wrap, f.description.wrap, f.due_date.wrap);

  if (editing) {
    modal.body.append(h('p', { class: 'meta-line' },
      `Criado em ${fmtDateTime(project.created_at)} · Atualizado em ${fmtDateTime(project.updated_at)}`));
    const archived = project.status === 'archived';
    const archiveBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, icon(archived ? 'restore' : 'archive'), archived ? 'Restaurar projeto' : 'Arquivar projeto');
    archiveBtn.addEventListener('click', async () => {
      if (!archived && !(await confirmDialog({
        title: 'Arquivar este projeto?',
        message: 'Ele sai da lista de projetos ativos, mas todas as tarefas ficam guardadas. Você pode restaurá-lo quando quiser em “Arquivados”.',
        confirmLabel: 'Arquivar projeto',
      }))) return;
      try {
        const r = await patch(`/projects/${project.id}`, { status: archived ? 'active' : 'archived' });
        modal.close();
        toast(archived ? 'Projeto restaurado.' : 'Projeto arquivado. Ele está em “Arquivados”.', 'success');
        onArchiveChange?.(r.project);
      } catch (err) {
        clear(errorSlot).append(banner('error', `${err.message} O projeto não foi alterado.`));
      }
    });
    const deleteBtn = h('button', { type: 'button', class: 'btn btn-danger-outline' }, icon('trash'), 'Excluir projeto');
    deleteBtn.addEventListener('click', async () => {
      if (!(await confirmDialog({
        title: `Excluir “${project.name}”?`,
        message: 'O projeto e todas as suas tarefas serão apagados de forma permanente. Para guardar sem apagar, prefira arquivar.',
        confirmLabel: 'Excluir definitivamente',
        danger: true,
      }))) return;
      try {
        await del(`/projects/${project.id}`);
        modal.close();
        toast('Projeto excluído.', 'success');
        onDeleted?.();
      } catch (err) {
        clear(errorSlot).append(banner('error', `${err.message} O projeto não foi excluído.`));
      }
    });
    modal.body.append(h('section', { class: 'danger-zone' },
      h('h3', null, 'Outras ações'),
      h('p', { class: 'muted' }, archived ? 'Restaurar devolve o projeto à lista de ativos.' : 'Arquivar preserva as tarefas e pode ser desfeito.'),
      h('div', { class: 'row wrap' }, archiveBtn, deleteBtn)));
  }

  const cancel = h('button', { type: 'button', class: 'btn btn-secondary', onclick: modal.requestClose }, 'Cancelar');
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, editing ? 'Salvar alterações' : 'Criar projeto');
  modal.footer.append(cancel, submit);
  f.name.control.focus();

  modal.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(errorSlot);
    Object.values(f).forEach((x) => x.setError(null));
    const data = { name: f.name.control.value, description: f.description.control.value, due_date: f.due_date.control.value || null };
    if (!data.name.trim()) {
      f.name.setError('Informe o nome do projeto.');
      f.name.control.focus();
      return;
    }
    await withBusy(submit, 'Salvando…', async () => {
      try {
        const r = editing ? await patch(`/projects/${project.id}`, data) : await post('/projects', { id: draftId, ...data });
        modal.close();
        toast(editing ? 'Projeto atualizado.' : 'Projeto criado.', 'success');
        onSaved?.(r.project);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        // Os dados digitados permanecem no formulário.
        if (!showFieldErrors(f, err.fields)) {
          errorSlot.append(banner('error', `Não foi possível salvar. ${err.message} O que você digitou continua aqui — tente novamente.`));
        }
      }
    });
  });
}

