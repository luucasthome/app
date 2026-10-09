// Testa a camada de dados da versão HTML única (public/js/local-api.js) com um localStorage de mentira.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const store = new Map();
let full = false;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
  removeItem: (k) => store.delete(k),
};
const L = await import('../public/js/local-api.js');

const uuid = () => crypto.randomUUID();
const titles = (tasks, column) => tasks.filter((t) => t.column === column).map((t) => t.title);
const reject = async (promise, status) => {
  await assert.rejects(promise, (e) => e instanceof L.ApiError && e.status === status);
};

beforeEach(() => { store.clear(); full = false; });

describe('versão HTML única: projetos', () => {
  it('cria, edita, arquiva, restaura e exclui; arquivado é somente leitura', async () => {
    await reject(L.post('/projects', { name: '  ' }), 400);
    const { project } = await L.post('/projects', { name: ' Site novo ', description: 'x', due_date: '2026-12-31' });
    assert.equal(project.name, 'Site novo');
    await reject(L.patch(`/projects/${project.id}`, { due_date: '2026-02-30' }), 400);
    assert.equal((await L.patch(`/projects/${project.id}`, { due_date: null })).project.due_date, null);

    await L.post(`/projects/${project.id}/tasks`, { title: 'Uma' });
    await L.patch(`/projects/${project.id}`, { status: 'archived' });
    assert.equal((await L.get('/projects')).projects.length, 0);
    const arch = await L.get('/projects?status=archived');
    assert.equal(arch.projects[0].task_count, 1);
    assert.deepEqual((await L.get('/projects')).counts, { active: 0, archived: 1 });
    await reject(L.post(`/projects/${project.id}/tasks`, { title: 'Nova' }), 409);
    await reject(L.patch(`/projects/${project.id}`, { name: 'x' }), 409);

    await L.patch(`/projects/${project.id}`, { status: 'active' });
    assert.equal((await L.get(`/projects/${project.id}`)).tasks.length, 1);
    assert.equal(await L.del(`/projects/${project.id}`), null);
    await reject(L.get(`/projects/${project.id}`), 404);
    assert.equal(JSON.parse(store.get('follow:dados:v1')).tasks.length, 0); // tarefas saem junto
  });

  it('repetir o envio com o mesmo id não duplica', async () => {
    const id = uuid();
    await Promise.all([1, 2, 3].map(() => L.post('/projects', { id, name: 'Único' })));
    assert.equal((await L.get('/projects')).projects.length, 1);
  });

  it('projeto demonstrativo é opcional e identificado', async () => {
    assert.equal((await L.get('/projects')).projects.length, 0);
    const { project } = await L.post('/projects/demo', { today: '2026-10-09' });
    assert.equal(project.is_demo, true);
    const { tasks } = await L.get(`/projects/${project.id}`);
    assert.ok(tasks.length >= 5);
    assert.ok(tasks.some((t) => t.due_date === '2026-10-07'));
    assert.ok(tasks.some((t) => t.due_date === '2026-10-09'));
  });
});

describe('versão HTML única: tarefas e Kanban', () => {
  it('só o título é obrigatório; aplica padrões e valida', async () => {
    const { project } = await L.post('/projects', { name: 'P' });
    await reject(L.post(`/projects/${project.id}/tasks`, { title: '' }), 400);
    await reject(L.post(`/projects/${project.id}/tasks`, { title: 'x', priority: 'urgente' }), 400);
    await reject(L.post(`/projects/${project.id}/tasks`, { title: 'x', due_date: '31/12/2026' }), 400);
    const { task } = await L.post(`/projects/${project.id}/tasks`, { title: 'Briefing' });
    assert.deepEqual([task.column, task.priority, task.due_date, task.checklist], ['todo', 'medium', null, []]);
  });

  it('edita checklist e descarta etapas vazias', async () => {
    const { project } = await L.post('/projects', { name: 'P' });
    const { task } = await L.post(`/projects/${project.id}/tasks`, { title: 'T' });
    const r = await L.patch(`/tasks/${task.id}`, { priority: 'high', checklist: [{ id: 'a', text: 'um', done: true }, { text: '  ' }, { text: 'dois' }] });
    assert.equal(r.task.priority, 'high');
    assert.deepEqual(r.task.checklist.map((i) => i.done), [true, false]);
  });

  it('move, reordena e persiste; coluna pelo formulário vai para o fim', async () => {
    const { project } = await L.post('/projects', { name: 'P' });
    const mk = async (title, column) => (await L.post(`/projects/${project.id}/tasks`, { title, column })).task;
    const [a, b, c] = [await mk('A', 'todo'), await mk('B', 'todo'), await mk('C', 'todo')];
    let r = await L.post(`/tasks/${c.id}/move`, { column: 'todo', before_id: a.id });
    assert.deepEqual(titles(r.tasks, 'todo'), ['C', 'A', 'B']);
    r = await L.post(`/tasks/${a.id}/move`, { column: 'doing', before_id: null });
    r = await L.post(`/tasks/${b.id}/move`, { column: 'doing', before_id: a.id });
    assert.deepEqual(titles(r.tasks, 'doing'), ['B', 'A']);
    assert.deepEqual(titles((await L.get(`/projects/${project.id}`)).tasks, 'todo'), ['C']);
    r = await L.patch(`/tasks/${c.id}`, { column: 'doing' });
    assert.deepEqual(titles(r.tasks, 'doing'), ['B', 'A', 'C']);
    await reject(L.post(`/tasks/${a.id}/move`, { column: 'nada' }), 400);
    await reject(L.post(`/tasks/${a.id}/move`, { column: 'todo', before_id: 'inexistente' }), 400);
  });

  it('duplica logo abaixo e exclui; criação repetida não duplica', async () => {
    const { project } = await L.post('/projects', { name: 'P' });
    const a = (await L.post(`/projects/${project.id}/tasks`, { title: 'A', checklist: [{ text: 'e1' }] })).task;
    await L.post(`/projects/${project.id}/tasks`, { title: 'B' });
    const r = await L.post(`/tasks/${a.id}/duplicate`, {});
    assert.deepEqual(titles(r.tasks, 'todo'), ['A', 'A (cópia)', 'B']);
    assert.equal(r.task.checklist.length, 1);
    await L.del(`/tasks/${r.task.id}`);
    const id = uuid();
    await Promise.all([1, 2, 3].map(() => L.post(`/projects/${project.id}/tasks`, { id, title: 'Uma só' })));
    assert.equal((await L.get(`/projects/${project.id}`)).tasks.length, 3);
  });

  it('o que a interface recebe não altera os dados guardados (cópias)', async () => {
    const { project } = await L.post('/projects', { name: 'P' });
    const r = await L.get(`/projects/${project.id}`);
    r.project.name = 'mudou por fora';
    assert.equal((await L.get(`/projects/${project.id}`)).project.name, 'P');
  });
});

describe('versão HTML única: armazenamento e backup', () => {
  it('falha ao gravar mantém os dados anteriores e avisa', async () => {
    const { project } = await L.post('/projects', { name: 'Seguro' });
    full = true;
    await assert.rejects(L.post(`/projects/${project.id}/tasks`, { title: 'Não cabe' }), (e) => e.code === 'storage');
    full = false;
    assert.equal((await L.get(`/projects/${project.id}`)).tasks.length, 0);
  });

  it('exporta e importa (ida e volta), recusando arquivos inválidos', async () => {
    const { project } = await L.post('/projects/demo', { today: '2026-10-09' });
    const before = await L.get(`/projects/${project.id}`);
    const backup = JSON.parse(JSON.stringify(L.exportData()));
    store.clear();
    assert.equal((await L.get('/projects')).projects.length, 0);
    const r = L.importData(backup);
    assert.equal(r.projects, 1);
    assert.deepEqual((await L.get(`/projects/${project.id}`)).tasks.map((t) => [t.title, t.column, t.position]),
      before.tasks.map((t) => [t.title, t.column, t.position]));

    for (const bad of [null, {}, { app: 'outro', projects: [], tasks: [] }, { app: 'follow', projects: [{ id: 'x', name: '', status: 'active' }], tasks: [] },
      { app: 'follow', projects: [], tasks: [{ id: 't', project_id: 'nenhum', title: 'x' }] }]) {
      assert.throws(() => L.importData(bad), (e) => e.code === 'bad_backup');
    }
    assert.equal((await L.get('/projects')).projects.length, 1); // recusar não apaga o que existe
  });
});
