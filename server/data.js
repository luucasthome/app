// Acesso a dados de projetos e tarefas. TODA consulta filtra por user_id:
// é essa a barreira que impede uma conta de enxergar dados de outra.

import { HttpError, notFound } from './http.js';

export const nowIso = () => new Date().toISOString();

export function projectOut(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    due_date: row.due_date,
    status: row.status,
    is_demo: !!row.is_demo,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.task_count !== undefined && { task_count: row.task_count, done_count: row.done_count }),
  };
}

export function taskOut(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    description: row.description,
    column: row.column_id,
    priority: row.priority,
    due_date: row.due_date,
    checklist: JSON.parse(row.checklist),
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getProject(db, userId, id) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw notFound('Projeto');
  return row;
}

export function getWritableProject(db, userId, id) {
  const row = getProject(db, userId, id);
  assertActive(row);
  return row;
}

export function assertActive(project) {
  if (project.status === 'archived') {
    throw new HttpError(409, 'project_archived', 'Este projeto está arquivado. Restaure-o para alterar as tarefas.');
  }
}

export function getTask(db, userId, id) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw notFound('Tarefa');
  return row;
}

export function listTasks(db, userId, projectId) {
  return db
    .prepare(
      `SELECT * FROM tasks WHERE project_id = ? AND user_id = ?
        ORDER BY CASE column_id WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 WHEN 'review' THEN 2 ELSE 3 END,
                 position, created_at`,
    )
    .all(projectId, userId)
    .map(taskOut);
}

export function touchProject(db, projectId) {
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(nowIso(), projectId);
}

export function nextPosition(db, projectId, column) {
  const { max } = db
    .prepare('SELECT MAX(position) AS max FROM tasks WHERE project_id = ? AND column_id = ?')
    .get(projectId, column);
  return (max ?? -1) + 1;
}

// Insere (ou move) a tarefa na coluna indicada, antes de `beforeId` (ou no fim) e renumera.
export function placeTask(db, projectId, taskId, column, beforeId) {
  const others = db
    .prepare('SELECT id FROM tasks WHERE project_id = ? AND column_id = ? AND id != ? ORDER BY position, created_at')
    .all(projectId, column, taskId)
    .map((r) => r.id);
  const at = beforeId ? others.indexOf(beforeId) : -1;
  if (at === -1) others.push(taskId);
  else others.splice(at, 0, taskId);
  const update = db.prepare('UPDATE tasks SET position = ?, column_id = ? WHERE id = ?');
  others.forEach((id, i) => update.run(i, column, id));
}
