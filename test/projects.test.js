import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { signUp, startServer } from './helpers.js';

let s;
before(async () => { s = await startServer(); });
after(() => s.close());

const uuid = () => crypto.randomUUID();
const titles = (tasks, column) => tasks.filter((t) => t.column === column).map((t) => t.title);

describe('projetos', () => {
  it('cria, edita, arquiva, restaura e exclui', async () => {
    const c = await signUp(s.base, 'Ana', 'ana@exemplo.com');
    assert.equal((await c.post('/api/projects', { name: '   ' })).status, 400);
    const created = await c.post('/api/projects', { name: ' Site novo ', description: 'Redesenho', due_date: '2026-12-31' });
    assert.equal(created.status, 201);
    const p = created.body.project;
    assert.equal(p.name, 'Site novo');
    assert.equal(p.status, 'active');
    assert.equal(p.task_count ?? 0, 0);

    assert.equal((await c.patch(`/api/projects/${p.id}`, { due_date: '2026-02-30' })).status, 400);
    const edited = await c.patch(`/api/projects/${p.id}`, { name: 'Site 2', due_date: null });
    assert.equal(edited.body.project.name, 'Site 2');
    assert.equal(edited.body.project.due_date, null);

    await c.post(`/api/projects/${p.id}/tasks`, { title: 'Uma tarefa' });
    await c.patch(`/api/projects/${p.id}`, { status: 'archived' });
    assert.equal((await c.get('/api/projects')).body.projects.length, 0);
    const arch = await c.get('/api/projects?status=archived');
    assert.equal(arch.body.projects.length, 1);
    assert.equal(arch.body.projects[0].task_count, 1); // tarefas preservadas
    assert.deepEqual((await c.get('/api/projects')).body.counts, { active: 0, archived: 1 });

    // projeto arquivado é somente leitura
    const blocked = await c.post(`/api/projects/${p.id}/tasks`, { title: 'Nova' });
    assert.equal(blocked.status, 409);
    assert.equal((await c.patch(`/api/projects/${p.id}`, { name: 'x' })).status, 409);

    await c.patch(`/api/projects/${p.id}`, { status: 'active' });
    assert.equal((await c.get(`/api/projects/${p.id}`)).body.tasks.length, 1);
    assert.equal((await c.del(`/api/projects/${p.id}`)).status, 204);
    assert.equal((await c.get(`/api/projects/${p.id}`)).status, 404);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 0); // cascata
  });

  it('repetir o mesmo envio (id do cliente) não duplica projetos', async () => {
    const c = await signUp(s.base, 'Bia', 'bia@exemplo.com');
    const id = uuid();
    const rs = await Promise.all([1, 2, 3, 4].map(() => c.post('/api/projects', { id, name: 'Único' })));
    assert.ok(rs.every((r) => r.status === 200 || r.status === 201));
    assert.equal((await c.get('/api/projects')).body.projects.length, 1);
  });

  it('projeto demonstrativo é opcional, identificado e removível', async () => {
    const c = await signUp(s.base, 'Caio', 'caio@exemplo.com');
    assert.equal((await c.get('/api/projects')).body.projects.length, 0); // nunca criado sozinho
    const demo = await c.post('/api/projects/demo', { today: '2026-10-09' });
    assert.equal(demo.status, 201);
    assert.equal(demo.body.project.is_demo, true);
    const full = await c.get(`/api/projects/${demo.body.project.id}`);
    assert.ok(full.body.tasks.length >= 5);
    assert.ok(full.body.tasks.some((t) => t.due_date === '2026-10-07')); // há uma atrasada
    assert.ok(full.body.tasks.some((t) => t.due_date === '2026-10-09')); // e uma para hoje
    assert.equal((await c.del(`/api/projects/${demo.body.project.id}`)).status, 204);
    assert.equal((await c.get('/api/projects')).body.projects.length, 0);
  });
});

describe('tarefas e Kanban', () => {
  it('cria só com título, aplica padrões e valida campos', async () => {
    const c = await signUp(s.base, 'Duda', 'duda@exemplo.com');
    const { project } = (await c.post('/api/projects', { name: 'P' })).body;
    assert.equal((await c.post(`/api/projects/${project.id}/tasks`, { title: '' })).status, 400);
    assert.equal((await c.post(`/api/projects/${project.id}/tasks`, { title: 'x', priority: 'urgente' })).status, 400);
    assert.equal((await c.post(`/api/projects/${project.id}/tasks`, { title: 'x', column: 'outra' })).status, 400);
    assert.equal((await c.post(`/api/projects/${project.id}/tasks`, { title: 'x', due_date: '31/12/2026' })).status, 400);
    const r = await c.post(`/api/projects/${project.id}/tasks`, { title: 'Escrever briefing' });
    assert.equal(r.status, 201);
    const t = r.body.task;
    assert.equal(t.column, 'todo');
    assert.equal(t.priority, 'medium');
    assert.equal(t.due_date, null);
    assert.deepEqual(t.checklist, []);
    assert.ok(t.created_at && t.updated_at);
  });

  it('edita campos e checklist; descarta etapas vazias', async () => {
    const c = await signUp(s.base, 'Eva', 'eva@exemplo.com');
    const { project } = (await c.post('/api/projects', { name: 'P' })).body;
    const { task } = (await c.post(`/api/projects/${project.id}/tasks`, { title: 'T' })).body;
    const r = await c.patch(`/api/tasks/${task.id}`, {
      title: 'T2', priority: 'high', due_date: '2026-11-01', description: 'desc',
      checklist: [{ id: 'a', text: 'um', done: true }, { text: '   ', done: false }, { text: 'dois' }],
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.task.title, 'T2');
    assert.equal(r.body.task.priority, 'high');
    assert.equal(r.body.task.checklist.length, 2);
    assert.deepEqual(r.body.task.checklist.map((i) => i.done), [true, false]);
    assert.ok(r.body.task.updated_at >= task.updated_at);
  });

  it('move entre colunas e reordena; a ordem persiste', async () => {
    const c = await signUp(s.base, 'Fábio', 'fabio@exemplo.com');
    const { project } = (await c.post('/api/projects', { name: 'P' })).body;
    const mk = async (title, column) => (await c.post(`/api/projects/${project.id}/tasks`, { title, column })).body.task;
    const [a, b, d] = [await mk('A', 'todo'), await mk('B', 'todo'), await mk('C', 'todo')];

    let r = await c.post(`/api/tasks/${d.id}/move`, { column: 'todo', before_id: a.id });
    assert.deepEqual(titles(r.body.tasks, 'todo'), ['C', 'A', 'B']);
    r = await c.post(`/api/tasks/${a.id}/move`, { column: 'doing', before_id: null });
    assert.deepEqual(titles(r.body.tasks, 'todo'), ['C', 'B']);
    assert.deepEqual(titles(r.body.tasks, 'doing'), ['A']);
    r = await c.post(`/api/tasks/${b.id}/move`, { column: 'doing', before_id: a.id });
    assert.deepEqual(titles(r.body.tasks, 'doing'), ['B', 'A']);
    r = await c.post(`/api/tasks/${d.id}/move`, { column: 'done' });
    assert.equal(r.body.task.column, 'done');

    // "recarregar a página": a ordem vem do servidor igual
    const again = await c.get(`/api/projects/${project.id}`);
    assert.deepEqual(titles(again.body.tasks, 'doing'), ['B', 'A']);
    assert.deepEqual(titles(again.body.tasks, 'done'), ['C']);

    // alterar a coluna pelo formulário manda a tarefa para o fim da nova coluna
    r = await c.patch(`/api/tasks/${b.id}`, { column: 'review' });
    assert.deepEqual(titles(r.body.tasks, 'review'), ['B']);
    assert.deepEqual(titles(r.body.tasks, 'doing'), ['A']);

    assert.equal((await c.post(`/api/tasks/${a.id}/move`, { column: 'invalida' })).status, 400);
    assert.equal((await c.post(`/api/tasks/${a.id}/move`, { column: 'todo', before_id: 'nao-existe' })).status, 400);
  });

  it('duplica logo abaixo da original e exclui', async () => {
    const c = await signUp(s.base, 'Gil', 'gil@exemplo.com');
    const { project } = (await c.post('/api/projects', { name: 'P' })).body;
    const mk = async (title) => (await c.post(`/api/projects/${project.id}/tasks`, { title, checklist: [{ text: 'e1' }] })).body.task;
    const a = await mk('A');
    await mk('B');
    const r = await c.post(`/api/tasks/${a.id}/duplicate`, {});
    assert.equal(r.status, 201);
    assert.deepEqual(titles(r.body.tasks, 'todo'), ['A', 'A (cópia)', 'B']);
    assert.equal(r.body.task.checklist.length, 1);
    assert.equal((await c.del(`/api/tasks/${r.body.task.id}`)).status, 204);
    assert.deepEqual(titles((await c.get(`/api/projects/${project.id}`)).body.tasks, 'todo'), ['A', 'B']);
  });

  it('cliques repetidos não duplicam tarefas (id gerado no cliente)', async () => {
    const c = await signUp(s.base, 'Ivo', 'ivo@exemplo.com');
    const { project } = (await c.post('/api/projects', { name: 'P' })).body;
    const id = uuid();
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => c.post(`/api/projects/${project.id}/tasks`, { id, title: 'Uma só' })));
    assert.ok(rs.every((r) => r.status === 200 || r.status === 201));
    assert.equal((await c.get(`/api/projects/${project.id}`)).body.tasks.length, 1);
  });

  it('progresso do projeto = tarefas em Concluído / total', async () => {
    const c = await signUp(s.base, 'Lia', 'lia@exemplo.com');
    const { project } = (await c.post('/api/projects', { name: 'P' })).body;
    let list = (await c.get('/api/projects')).body.projects[0];
    assert.equal(list.task_count, 0);
    assert.equal(list.done_count, 0);
    const t1 = (await c.post(`/api/projects/${project.id}/tasks`, { title: '1' })).body.task;
    await c.post(`/api/projects/${project.id}/tasks`, { title: '2' });
    await c.post(`/api/tasks/${t1.id}/move`, { column: 'done' });
    list = (await c.get('/api/projects')).body.projects[0];
    assert.equal(list.task_count, 2);
    assert.equal(list.done_count, 1);
  });
});

describe('isolamento entre contas (validado no servidor)', () => {
  it('uma conta não lê, altera, move, duplica ou exclui dados de outra', async () => {
    const alice = await signUp(s.base, 'Alice', 'alice@exemplo.com');
    const bruno = await signUp(s.base, 'Bruno', 'bruno@exemplo.com');
    const { project } = (await alice.post('/api/projects', { name: 'Segredo da Alice' })).body;
    const { task } = (await alice.post(`/api/projects/${project.id}/tasks`, { title: 'Tarefa privada' })).body;
    const mine = (await bruno.post('/api/projects', { name: 'Do Bruno' })).body.project;
    const mineTask = (await bruno.post(`/api/projects/${mine.id}/tasks`, { title: 'Do Bruno' })).body.task;

    // listagem não vaza
    const list = await bruno.get('/api/projects');
    assert.deepEqual(list.body.projects.map((p) => p.name), ['Do Bruno']);
    assert.ok(!JSON.stringify(list.body).includes('Segredo'));

    // leitura e escrita em projeto alheio
    assert.equal((await bruno.get(`/api/projects/${project.id}`)).status, 404);
    assert.equal((await bruno.patch(`/api/projects/${project.id}`, { name: 'hackeado' })).status, 404);
    assert.equal((await bruno.del(`/api/projects/${project.id}`)).status, 404);
    assert.equal((await bruno.post(`/api/projects/${project.id}/tasks`, { title: 'invasão' })).status, 404);

    // tarefas alheias
    assert.equal((await bruno.patch(`/api/tasks/${task.id}`, { title: 'hackeado' })).status, 404);
    assert.equal((await bruno.post(`/api/tasks/${task.id}/move`, { column: 'done' })).status, 404);
    assert.equal((await bruno.post(`/api/tasks/${task.id}/duplicate`, {})).status, 404);
    assert.equal((await bruno.del(`/api/tasks/${task.id}`)).status, 404);

    // tentar "encaixar" uma tarefa própria ao lado de uma tarefa alheia
    assert.equal((await bruno.post(`/api/tasks/${mineTask.id}/move`, { column: 'todo', before_id: task.id })).status, 400);

    // reutilizar o id de um projeto/tarefa alheio na criação
    assert.equal((await bruno.post('/api/projects', { id: project.id, name: 'roubo' })).status, 409);
    assert.equal((await bruno.post(`/api/projects/${mine.id}/tasks`, { id: task.id, title: 'roubo' })).status, 409);

    // nada mudou para a Alice
    const full = (await alice.get(`/api/projects/${project.id}`)).body;
    assert.equal(full.project.name, 'Segredo da Alice');
    assert.equal(full.tasks.length, 1);
    assert.equal(full.tasks[0].title, 'Tarefa privada');
  });
});
