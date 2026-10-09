export const COLUMNS = [
  { id: 'todo', title: 'A fazer' },
  { id: 'doing', title: 'Em andamento' },
  { id: 'review', title: 'Em revisão' },
  { id: 'done', title: 'Concluído' },
];
export const columnTitle = (id) => COLUMNS.find((c) => c.id === id)?.title ?? id;

export const PRIORITIES = [
  { id: 'low', title: 'Baixa' },
  { id: 'medium', title: 'Média' },
  { id: 'high', title: 'Alta' },
];
export const priorityTitle = (id) => PRIORITIES.find((p) => p.id === id)?.title ?? id;

// Atrasada = prazo já passou e a tarefa não está em "Concluído".
export const isOverdue = (task, today) => !!task.due_date && task.due_date < today && task.column !== 'done';
