// Validação e normalização de entradas. Cada função devolve { value, errors }.

export const COLUMNS = ['todo', 'doing', 'review', 'done'];
export const PRIORITIES = ['low', 'medium', 'high'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export function isValidDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function str(body, key, { min = 0, max, label, required = false }, out, errors) {
  if (!(key in body) || body[key] === undefined) return false;
  const raw = body[key];
  if (raw === null) {
    if (required) errors[key] = `Informe ${label}.`;
    else out[key] = '';
    return true;
  }
  if (typeof raw !== 'string') {
    errors[key] = `${label[0].toUpperCase()}${label.slice(1)} inválido.`;
    return true;
  }
  const value = raw.trim();
  if (required && value.length < Math.max(min, 1)) errors[key] = `Informe ${label}.`;
  else if (value.length > max) errors[key] = `Use no máximo ${max} caracteres.`;
  else out[key] = value;
  return true;
}

function date(body, key, out, errors) {
  if (!(key in body) || body[key] === undefined) return;
  const v = body[key];
  if (v === null || v === '') out[key] = null;
  else if (isValidDate(v)) out[key] = v;
  else errors[key] = 'Informe uma data válida.';
}

function oneOf(body, key, list, message, out, errors) {
  if (!(key in body) || body[key] === undefined) return;
  if (list.includes(body[key])) out[key] = body[key];
  else errors[key] = message;
}

export function validateId(body, errors) {
  if (body.id === undefined) return undefined;
  if (!isUuid(body.id)) {
    errors.id = 'Identificador inválido.';
    return undefined;
  }
  return body.id.toLowerCase();
}

export function validateProjectInput(body, { partial }) {
  const out = {};
  const errors = {};
  str(body, 'name', { max: 120, label: 'o nome do projeto', required: true }, out, errors);
  str(body, 'description', { max: 2000, label: 'a descrição' }, out, errors);
  date(body, 'due_date', out, errors);
  oneOf(body, 'status', ['active', 'archived'], 'Situação inválida.', out, errors);
  if (!partial && !('name' in out) && !errors.name) errors.name = 'Informe o nome do projeto.';
  return { value: out, errors };
}

function validateChecklist(body, out, errors) {
  if (!('checklist' in body) || body.checklist === undefined) return;
  const list = body.checklist;
  if (!Array.isArray(list)) {
    errors.checklist = 'Checklist inválido.';
    return;
  }
  if (list.length > 50) {
    errors.checklist = 'Use no máximo 50 etapas.';
    return;
  }
  const items = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string') {
      errors.checklist = 'Checklist inválido.';
      return;
    }
    const text = raw.text.trim();
    if (!text) continue; // etapas vazias são descartadas
    if (text.length > 200) {
      errors.checklist = 'Cada etapa pode ter no máximo 200 caracteres.';
      return;
    }
    let id = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : null;
    if (!id || seen.has(id)) id = `e${items.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
    seen.add(id);
    items.push({ id, text, done: raw.done === true });
  }
  out.checklist = items;
}

export function validateTaskInput(body, { partial }) {
  const out = {};
  const errors = {};
  str(body, 'title', { max: 200, label: 'o título da tarefa', required: true }, out, errors);
  str(body, 'description', { max: 5000, label: 'a descrição' }, out, errors);
  date(body, 'due_date', out, errors);
  oneOf(body, 'column', COLUMNS, 'Coluna inválida.', out, errors);
  oneOf(body, 'priority', PRIORITIES, 'Prioridade inválida.', out, errors);
  validateChecklist(body, out, errors);
  if (!partial && !('title' in out) && !errors.title) errors.title = 'Informe o título da tarefa.';
  return { value: out, errors };
}

export function validateEmail(raw) {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!email) return { error: 'Informe seu e-mail.' };
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: 'Informe um e-mail válido.' };
  return { value: email };
}

export function validatePassword(raw) {
  if (typeof raw !== 'string' || !raw) return { error: 'Informe uma senha.' };
  if (raw.length < 8) return { error: 'A senha precisa ter pelo menos 8 caracteres.' };
  if (raw.length > 200) return { error: 'A senha pode ter no máximo 200 caracteres.' };
  return { value: raw };
}

export function validateName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return { error: 'Informe seu nome.' };
  if (name.length > 80) return { error: 'Use no máximo 80 caracteres.' };
  return { value: name };
}
