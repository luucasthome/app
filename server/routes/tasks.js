import crypto from 'node:crypto';
import { Router } from 'express';
import {
  assertActive, getProject, getTask, getWritableProject, listTasks, nextPosition, nowIso, placeTask, taskOut,
  touchProject,
} from '../data.js';
import { HttpError, validationError } from '../http.js';
import { COLUMNS, validateId, validateTaskInput } from '../validate.js';

export function tasksRouter({ db }) {
  const router = Router();

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, project_id, user_id, title, description, column_id, priority, due_date, checklist, position, created_at, updated_at)
     VALUES (@id, @project_id, @user_id, @title, @description, @column_id, @priority, @due_date, @checklist, @position, @created_at, @updated_at)`,
  );

  // Se o id já existe para este usuário, o envio é uma repetição: devolve o que já foi gravado.
  function existingTask(id, userId) {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) return null;
    if (row.user_id !== userId) throw new HttpError(409, 'id_in_use', 'Identificador já utilizado.');
    return row;
  }

  router.post('/projects/:projectId/tasks', (req, res) => {
    const { value, errors } = validateTaskInput(req.body, { partial: false });
    const id = validateId(req.body, errors) ?? crypto.randomUUID();
    if (Object.keys(errors).length) throw validationError(errors);

    const project = getProject(db, req.user.id, req.params.projectId);
    const again = existingTask(id, req.user.id);
    if (again) return res.json({ task: taskOut(again), tasks: listTasks(db, req.user.id, again.project_id) });
    assertActive(project);

    const column = value.column ?? 'todo';
    const now = nowIso();
    db.transaction(() => {
      insertTask.run({
        id,
        project_id: project.id,
        user_id: req.user.id,
        title: value.title,
        description: value.description ?? '',
        column_id: column,
        priority: value.priority ?? 'medium',
        due_date: value.due_date ?? null,
        checklist: JSON.stringify(value.checklist ?? []),
        position: nextPosition(db, project.id, column),
        created_at: now,
        updated_at: now,
      });
      touchProject(db, project.id);
    })();
    res.status(201).json({ task: taskOut(getTask(db, req.user.id, id)), tasks: listTasks(db, req.user.id, project.id) });
  });

  router.patch('/tasks/:id', (req, res) => {
    const task = getTask(db, req.user.id, req.params.id);
    getWritableProject(db, req.user.id, task.project_id);
    const { value, errors } = validateTaskInput(req.body, { partial: true });
    if (Object.keys(errors).length) throw validationError(errors);

    db.transaction(() => {
      const next = {
        title: value.title ?? task.title,
        description: value.description ?? task.description,
        priority: value.priority ?? task.priority,
        due_date: 'due_date' in value ? value.due_date : task.due_date,
        checklist: JSON.stringify(value.checklist ?? JSON.parse(task.checklist)),
      };
      db.prepare(
        'UPDATE tasks SET title = ?, description = ?, priority = ?, due_date = ?, checklist = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      ).run(next.title, next.description, next.priority, next.due_date, next.checklist, nowIso(), task.id, req.user.id);
      // Mudar a coluna pelo formulário leva a tarefa para o fim da nova coluna.
      if (value.column && value.column !== task.column_id) placeTask(db, task.project_id, task.id, value.column, null);
      touchProject(db, task.project_id);
    })();
    res.json({
      task: taskOut(getTask(db, req.user.id, task.id)),
      tasks: listTasks(db, req.user.id, task.project_id),
    });
  });

  router.post('/tasks/:id/move', (req, res) => {
    const task = getTask(db, req.user.id, req.params.id);
    getWritableProject(db, req.user.id, task.project_id);
    const { column, before_id: beforeId = null } = req.body;
    if (!COLUMNS.includes(column)) throw validationError({ column: 'Coluna inválida.' });
    if (beforeId !== null && typeof beforeId !== 'string') throw validationError({ before_id: 'Referência inválida.' });
    if (beforeId) {
      // A referência precisa ser uma tarefa deste mesmo projeto e usuário.
      const ref = db
        .prepare('SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND user_id = ? AND column_id = ?')
        .get(beforeId, task.project_id, req.user.id, column);
      if (!ref) throw validationError({ before_id: 'Referência inválida.' });
    }
    db.transaction(() => {
      placeTask(db, task.project_id, task.id, column, beforeId);
      db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(nowIso(), task.id);
      touchProject(db, task.project_id);
    })();
    res.json({
      task: taskOut(getTask(db, req.user.id, task.id)),
      tasks: listTasks(db, req.user.id, task.project_id),
    });
  });

  router.post('/tasks/:id/duplicate', (req, res) => {
    const source = getTask(db, req.user.id, req.params.id);
    getWritableProject(db, req.user.id, source.project_id);
    const errors = {};
    const id = validateId(req.body, errors) ?? crypto.randomUUID();
    if (Object.keys(errors).length) throw validationError(errors);

    const again = existingTask(id, req.user.id);
    if (again) return res.json({ task: taskOut(again), tasks: listTasks(db, req.user.id, again.project_id) });

    const title = `${source.title.slice(0, 190)} (cópia)`;
    const now = nowIso();
    db.transaction(() => {
      insertTask.run({
        id,
        project_id: source.project_id,
        user_id: req.user.id,
        title,
        description: source.description,
        column_id: source.column_id,
        priority: source.priority,
        due_date: source.due_date,
        checklist: source.checklist,
        position: 0,
        created_at: now,
        updated_at: now,
      });
      // Coloca a cópia logo abaixo da original.
      const following = db
        .prepare(
          'SELECT id FROM tasks WHERE project_id = ? AND column_id = ? AND id NOT IN (?, ?) AND position > ? ORDER BY position LIMIT 1',
        )
        .get(source.project_id, source.column_id, id, source.id, source.position);
      placeTask(db, source.project_id, id, source.column_id, following?.id ?? null);
      touchProject(db, source.project_id);
    })();
    res.status(201).json({ task: taskOut(getTask(db, req.user.id, id)), tasks: listTasks(db, req.user.id, source.project_id) });
  });

  router.delete('/tasks/:id', (req, res) => {
    const task = getTask(db, req.user.id, req.params.id);
    getWritableProject(db, req.user.id, task.project_id);
    db.transaction(() => {
      db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(task.id, req.user.id);
      touchProject(db, task.project_id);
    })();
    res.status(204).end();
  });

  return router;
}
