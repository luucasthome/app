import crypto from 'node:crypto';
import { Router } from 'express';
import { getProject, listTasks, nowIso, projectOut } from '../data.js';
import { HttpError, validationError } from '../http.js';
import { DEMO_PROJECT, DEMO_TASKS, addDays } from '../demo.js';
import { isValidDate, validateId, validateProjectInput } from '../validate.js';

const LIST_SQL = `
  SELECT p.*,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.column_id = 'done') AS done_count
    FROM projects p
   WHERE p.user_id = ? AND p.status = ?
   ORDER BY p.updated_at DESC`;

export function projectsRouter({ db }) {
  const router = Router();

  router.get('/', (req, res) => {
    const status = req.query.status === 'archived' ? 'archived' : 'active';
    const counts = db
      .prepare('SELECT status, COUNT(*) AS n FROM projects WHERE user_id = ? GROUP BY status')
      .all(req.user.id);
    res.json({
      projects: db.prepare(LIST_SQL).all(req.user.id, status).map(projectOut),
      counts: {
        active: counts.find((c) => c.status === 'active')?.n ?? 0,
        archived: counts.find((c) => c.status === 'archived')?.n ?? 0,
      },
    });
  });

  router.post('/', (req, res) => {
    const { value, errors } = validateProjectInput(req.body, { partial: false });
    const id = validateId(req.body, errors) ?? crypto.randomUUID();
    if (Object.keys(errors).length) throw validationError(errors);

    // Idempotência: repetir o mesmo envio (clique duplo, nova tentativa) devolve o projeto já criado.
    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (existing) {
      if (existing.user_id !== req.user.id) throw new HttpError(409, 'id_in_use', 'Identificador já utilizado.');
      return res.json({ project: projectOut(existing) });
    }

    const now = nowIso();
    db.prepare(
      `INSERT INTO projects (id, user_id, name, description, due_date, status, is_demo, created_at, updated_at)
       VALUES (?,?,?,?,?, 'active', 0, ?, ?)`,
    ).run(id, req.user.id, value.name, value.description ?? '', value.due_date ?? null, now, now);
    res.status(201).json({ project: projectOut(getProject(db, req.user.id, id)) });
  });

  router.post('/demo', (req, res) => {
    const errors = {};
    const id = validateId(req.body, errors) ?? crypto.randomUUID();
    if (Object.keys(errors).length) throw validationError(errors);
    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (existing) {
      if (existing.user_id !== req.user.id) throw new HttpError(409, 'id_in_use', 'Identificador já utilizado.');
      return res.json({ project: projectOut(existing) });
    }

    const today = isValidDate(req.body.today) ? req.body.today : new Date().toISOString().slice(0, 10);
    const now = nowIso();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO projects (id, user_id, name, description, due_date, status, is_demo, created_at, updated_at)
         VALUES (?,?,?,?,?, 'active', 1, ?, ?)`,
      ).run(
        id,
        req.user.id,
        DEMO_PROJECT.name,
        DEMO_PROJECT.description,
        addDays(today, DEMO_PROJECT.dueOffset),
        now,
        now,
      );
      const insert = db.prepare(
        `INSERT INTO tasks (id, project_id, user_id, title, description, column_id, priority, due_date, checklist, position, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const positions = {};
      for (const t of DEMO_TASKS) {
        const pos = (positions[t.column] = (positions[t.column] ?? -1) + 1);
        const checklist = t.checklist.map(([text, done], i) => ({ id: `d${i + 1}`, text, done }));
        insert.run(
          crypto.randomUUID(), id, req.user.id, t.title, t.description, t.column, t.priority,
          t.offset === null ? null : addDays(today, t.offset), JSON.stringify(checklist), pos, now, now,
        );
      }
    })();
    res.status(201).json({ project: projectOut(getProject(db, req.user.id, id)) });
  });

  router.get('/:id', (req, res) => {
    const project = getProject(db, req.user.id, req.params.id);
    res.json({ project: projectOut(project), tasks: listTasks(db, req.user.id, project.id) });
  });

  router.patch('/:id', (req, res) => {
    const project = getProject(db, req.user.id, req.params.id);
    const { value, errors } = validateProjectInput(req.body, { partial: true });
    if (Object.keys(errors).length) throw validationError(errors);

    // Projeto arquivado só aceita ser restaurado (ou ter o status alterado).
    if (project.status === 'archived' && value.status !== 'active' && Object.keys(value).some((k) => k !== 'status')) {
      throw new HttpError(409, 'project_archived', 'Este projeto está arquivado. Restaure-o para editar.');
    }
    const next = { ...project, ...value };
    db.prepare('UPDATE projects SET name = ?, description = ?, due_date = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
      next.name, next.description, next.due_date, next.status, nowIso(), project.id, req.user.id,
    );
    res.json({ project: projectOut(getProject(db, req.user.id, project.id)) });
  });

  router.delete('/:id', (req, res) => {
    const project = getProject(db, req.user.id, req.params.id);
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(project.id, req.user.id);
    res.status(204).end();
  });

  return router;
}
