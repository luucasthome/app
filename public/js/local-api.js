// Versão "HTML único": no lugar do servidor, esta camada guarda tudo no navegador (localStorage).
// Ela responde às MESMAS rotas e formatos de api.js, então toda a interface funciona sem mudanças.
// É usada apenas pelo build standalone (scripts/build-standalone.mjs), que troca api.js por este arquivo.

import { DEMO_PROJECT, DEMO_TASKS, addDays } from '../../server/demo.js';
import { COLUMNS, isValidDate, validateId, validateProjectInput, validateTaskInput } from '../../server/validate.js';
import { newId } from './ui.js';

export const LOCAL = true;

export class ApiError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
export const setUnauthorizedHandler = () => {}; // sem login, a sessão nunca expira

const KEY = 'follow:dados:v1';
const USER = { id: 'local', name: 'Neste navegador', email: '' };
const empty = () => ({ version: 1, projects: [], tasks: [] });
const COLUMN_ORDER = Object.fromEntries(COLUMNS.map((c, i) => [c, i]));

let fallback = null; // usado se o navegador bloquear o armazenamento (ex.: janela privada em alguns navegadores)

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
    return fallback ? JSON.parse(fallback) : empty();
  } catch {
    return fallback ? JSON.parse(fallback) : empty();
  }
}

function write(state) {
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(KEY, raw);
    fallback = null;
  } catch {
    throw new ApiError(0, 'storage', 'Não foi possível gravar neste navegador (armazenamento cheio ou bloqueado). Exporte um backup e libere espaço.');
  }
}

// Toda alteração lê o estado mais recente (outra aba pode ter mudado algo), aplica e grava de uma vez.
function mutate(fn) {
  const state = read();
  const result = fn(state);
  write(state);
  return result;
}

const now = () => new Date().toISOString();
const notFound = (what) => new ApiError(404, 'not_found', `${what} não encontrado.`);
const validation = (fields) => new ApiError(400, 'validation', 'Revise os campos destacados.', fields);
const idInUse = () => new ApiError(409, 'id_in_use', 'Identificador já utilizado.');

const findProject = (state, id) => {
  const p = state.projects.find((x) => x.id === id);
  if (!p) throw notFound('Projeto');
  return p;
};
const findTask = (state, id) => {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) throw notFound('Tarefa');
  return t;
};
const assertActive = (p) => {
  if (p.status === 'archived') throw new ApiError(409, 'project_archived', 'Este projeto está arquivado. Restaure-o para alterar as tarefas.');
};

function sortedTasks(state, projectId) {
  return state.tasks
    .filter((t) => t.project_id === projectId)
    .sort((a, b) => COLUMN_ORDER[a.column] - COLUMN_ORDER[b.column] || a.position - b.position || a.created_at.localeCompare(b.created_at));
}

const columnTasks = (state, projectId, column) =>
  state.tasks
    .filter((t) => t.project_id === projectId && t.column === column)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

const nextPosition = (state, projectId, column) => columnTasks(state, projectId, column).length;

// Coloca a tarefa na coluna, antes de `beforeId` (ou no fim), e renumera as posições da coluna.
function placeTask(state, task, column, beforeId) {
  const others = columnTasks(state, task.project_id, column).filter((t) => t.id !== task.id);
  const at = beforeId ? others.findIndex((t) => t.id === beforeId) : -1;
  if (at === -1) others.push(task);
  else others.splice(at, 0, task);
  others.forEach((t, i) => { t.column = column; t.position = i; });
}

const touch = (project) => { project.updated_at = now(); };
const clone = (v) => JSON.parse(JSON.stringify(v));

function projectOut(state, p, withCounts = false) {
  const out = { ...p };
  if (withCounts) {
    const own = state.tasks.filter((t) => t.project_id === p.id);
    out.task_count = own.length;
    out.done_count = own.filter((t) => t.column === 'done').length;
  }
  return out;
}

// ---------- Rotas ----------
function listProjects(query) {
  const state = read();
  const status = query.get('status') === 'archived' ? 'archived' : 'active';
  const count = (s) => state.projects.filter((p) => p.status === s).length;
  return {
    projects: state.projects
      .filter((p) => p.status === status)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((p) => projectOut(state, p, true)),
    counts: { active: count('active'), archived: count('archived') },
  };
}

function createProject(body) {
  const { value, errors } = validateProjectInput(body, { partial: false });
  const id = validateId(body, errors) ?? newId();
  if (Object.keys(errors).length) throw validation(errors);
  return mutate((state) => {
    const existing = state.projects.find((p) => p.id === id);
    if (existing) return { project: projectOut(state, existing) }; // repetição do mesmo envio
    const t = now();
    const project = { id, name: value.name, description: value.description ?? '', due_date: value.due_date ?? null, status: 'active', is_demo: false, created_at: t, updated_at: t };
    state.projects.push(project);
    return { project: projectOut(state, project) };
  });
}

function createDemo(body) {
  const errors = {};
  const id = validateId(body, errors) ?? newId();
  if (Object.keys(errors).length) throw validation(errors);
  return mutate((state) => {
    const existing = state.projects.find((p) => p.id === id);
    if (existing) return { project: projectOut(state, existing) };
    const today = isValidDate(body.today) ? body.today : new Date().toISOString().slice(0, 10);
    const t = now();
    const project = { id, name: DEMO_PROJECT.name, description: DEMO_PROJECT.description, due_date: addDays(today, DEMO_PROJECT.dueOffset), status: 'active', is_demo: true, created_at: t, updated_at: t };
    state.projects.push(project);
    const positions = {};
    for (const d of DEMO_TASKS) {
      const position = (positions[d.column] = (positions[d.column] ?? -1) + 1);
      state.tasks.push({
        id: newId(), project_id: id, title: d.title, description: d.description, column: d.column, priority: d.priority,
        due_date: d.offset === null ? null : addDays(today, d.offset),
        checklist: d.checklist.map(([text, done], i) => ({ id: `d${i + 1}`, text, done })),
        position, created_at: t, updated_at: t,
      });
    }
    return { project: projectOut(state, project) };
  });
}

function getProject(id) {
  const state = read();
  const project = findProject(state, id);
  return { project: projectOut(state, project), tasks: sortedTasks(state, id) };
}

function patchProject(id, body) {
  const { value, errors } = validateProjectInput(body, { partial: true });
  if (Object.keys(errors).length) throw validation(errors);
  return mutate((state) => {
    const project = findProject(state, id);
    if (project.status === 'archived' && value.status !== 'active' && Object.keys(value).some((k) => k !== 'status')) {
      throw new ApiError(409, 'project_archived', 'Este projeto está arquivado. Restaure-o para editar.');
    }
    Object.assign(project, value);
    touch(project);
    return { project: projectOut(state, project) };
  });
}

function deleteProject(id) {
  return mutate((state) => {
    findProject(state, id);
    state.projects = state.projects.filter((p) => p.id !== id);
    state.tasks = state.tasks.filter((t) => t.project_id !== id);
    return null;
  });
}

function createTask(projectId, body) {
  const { value, errors } = validateTaskInput(body, { partial: false });
  const id = validateId(body, errors) ?? newId();
  if (Object.keys(errors).length) throw validation(errors);
  return mutate((state) => {
    const project = findProject(state, projectId);
    const again = state.tasks.find((t) => t.id === id);
    if (again) {
      if (again.project_id !== projectId) throw idInUse();
      return { task: again, tasks: sortedTasks(state, again.project_id) };
    }
    assertActive(project);
    const column = value.column ?? 'todo';
    const t = now();
    const task = {
      id, project_id: projectId, title: value.title, description: value.description ?? '', column,
      priority: value.priority ?? 'medium', due_date: value.due_date ?? null, checklist: value.checklist ?? [],
      position: nextPosition(state, projectId, column), created_at: t, updated_at: t,
    };
    state.tasks.push(task);
    touch(project);
    return { task, tasks: sortedTasks(state, projectId) };
  });
}

function patchTask(id, body) {
  const { value, errors } = validateTaskInput(body, { partial: true });
  if (Object.keys(errors).length) throw validation(errors);
  return mutate((state) => {
    const task = findTask(state, id);
    const project = findProject(state, task.project_id);
    assertActive(project);
    const { column, ...fields } = value;
    Object.assign(task, fields);
    task.updated_at = now();
    // Mudar a coluna pelo formulário leva a tarefa para o fim da nova coluna.
    if (column && column !== task.column) placeTask(state, task, column, null);
    touch(project);
    return { task, tasks: sortedTasks(state, task.project_id) };
  });
}

function moveTask(id, body) {
  const { column, before_id: beforeId = null } = body;
  if (!COLUMNS.includes(column)) throw validation({ column: 'Coluna inválida.' });
  if (beforeId !== null && typeof beforeId !== 'string') throw validation({ before_id: 'Referência inválida.' });
  return mutate((state) => {
    const task = findTask(state, id);
    const project = findProject(state, task.project_id);
    assertActive(project);
    if (beforeId && !state.tasks.some((t) => t.id === beforeId && t.project_id === task.project_id && t.column === column)) {
      throw validation({ before_id: 'Referência inválida.' });
    }
    placeTask(state, task, column, beforeId);
    task.updated_at = now();
    touch(project);
    return { task, tasks: sortedTasks(state, task.project_id) };
  });
}

function duplicateTask(id, body) {
  const errors = {};
  const newTaskId = validateId(body, errors) ?? newId();
  if (Object.keys(errors).length) throw validation(errors);
  return mutate((state) => {
    const source = findTask(state, id);
    const project = findProject(state, source.project_id);
    assertActive(project);
    const again = state.tasks.find((t) => t.id === newTaskId);
    if (again) {
      if (again.project_id !== source.project_id) throw idInUse();
      return { task: again, tasks: sortedTasks(state, again.project_id) };
    }
    const t = now();
    const copy = { ...clone(source), id: newTaskId, title: `${source.title.slice(0, 190)} (cópia)`, created_at: t, updated_at: t };
    state.tasks.push(copy);
    // A cópia entra logo abaixo da original.
    const following = columnTasks(state, source.project_id, source.column).find((x) => x.id !== newTaskId && x.id !== source.id && x.position > source.position);
    placeTask(state, copy, source.column, following?.id ?? null);
    touch(project);
    return { task: copy, tasks: sortedTasks(state, source.project_id) };
  });
}

function deleteTask(id) {
  return mutate((state) => {
    const task = findTask(state, id);
    const project = findProject(state, task.project_id);
    assertActive(project);
    state.tasks = state.tasks.filter((t) => t.id !== id);
    touch(project);
    return null;
  });
}

function route(method, path, body) {
  const [pathname, qs = ''] = path.split('?');
  const query = new URLSearchParams(qs);
  const s = pathname.split('/').filter(Boolean);
  const is = (m, ...parts) => method === m && s.length === parts.length && parts.every((p, i) => p === null || p === s[i]);

  if (is('GET', 'auth', 'me')) return { user: USER };
  if (is('POST', 'auth', 'logout')) return null;
  if (is('GET', 'projects')) return listProjects(query);
  if (is('POST', 'projects')) return createProject(body);
  if (is('POST', 'projects', 'demo')) return createDemo(body);
  if (is('GET', 'projects', null)) return getProject(s[1]);
  if (is('PATCH', 'projects', null)) return patchProject(s[1], body);
  if (is('DELETE', 'projects', null)) return deleteProject(s[1]);
  if (is('POST', 'projects', null, 'tasks')) return createTask(s[1], body);
  if (is('PATCH', 'tasks', null)) return patchTask(s[1], body);
  if (is('DELETE', 'tasks', null)) return deleteTask(s[1]);
  if (is('POST', 'tasks', null, 'move')) return moveTask(s[1], body);
  if (is('POST', 'tasks', null, 'duplicate')) return duplicateTask(s[1], body);
  throw new ApiError(404, 'not_found', 'Recurso não encontrado.');
}

export async function api(method, path, body) {
  const result = route(method, path, body ?? {});
  return result === null ? null : clone(result);
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);

// ---------- Backup ----------
export function exportData() {
  return { app: 'follow', ...read(), exported_at: now() };
}

// Valida e normaliza um arquivo de backup SEM gravar nada (permite avisar antes de perguntar).
export function parseBackup(data) {
  const bad = () => new ApiError(400, 'bad_backup', 'Este arquivo não parece ser um backup do Follow.');
  if (!data || typeof data !== 'object' || data.app !== 'follow' || !Array.isArray(data.projects) || !Array.isArray(data.tasks)) throw bad();
  const projects = [];
  for (const p of data.projects) {
    const { value, errors } = validateProjectInput(p ?? {}, { partial: false });
    if (Object.keys(errors).length || !p.id || !['active', 'archived'].includes(p.status)) throw bad();
    projects.push({
      id: String(p.id), name: value.name, description: value.description ?? '', due_date: value.due_date ?? null, status: p.status,
      is_demo: p.is_demo === true, created_at: String(p.created_at ?? now()), updated_at: String(p.updated_at ?? now()),
    });
  }
  const ids = new Set(projects.map((p) => p.id));
  const tasks = [];
  for (const t of data.tasks) {
    const { value, errors } = validateTaskInput(t ?? {}, { partial: false });
    if (Object.keys(errors).length || !t.id || !ids.has(t.project_id)) throw bad();
    tasks.push({
      id: String(t.id), project_id: t.project_id, title: value.title, description: value.description ?? '', column: value.column ?? 'todo',
      priority: value.priority ?? 'medium', due_date: value.due_date ?? null, checklist: value.checklist ?? [],
      position: Number.isInteger(t.position) ? t.position : 0, created_at: String(t.created_at ?? now()), updated_at: String(t.updated_at ?? now()),
    });
  }
  return { projects, tasks };
}

// Substitui todos os dados pelo conteúdo já validado de parseBackup.
export function restoreBackup({ projects, tasks }) {
  write({ version: 1, projects, tasks });
  return { projects: projects.length, tasks: tasks.length };
}

export const importData = (data) => restoreBackup(parseBackup(data));
