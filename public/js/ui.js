// Utilitários de interface: criação de elementos, ícones, datas, avisos e diálogos.
// Todo conteúdo do usuário entra por textContent/atributos — nunca por innerHTML.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clear = (el) => { el.replaceChildren(); return el; };

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checklist: '<path d="m4 6 1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6.5h9M11 12.5h9M11 18.5h9"/>',
  logout: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
  alert: '<path d="M12 4 2.5 20h19L12 4zM12 10v4.5M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
  return span;
}

// ---------- Datas (interface sempre em dia/mês/ano) ----------
const pad = (n) => String(n).padStart(2, '0');
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const fmtDate = (s) => (s ? s.split('-').reverse().join('/') : '');
export const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const weekday = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
};

export const debounce = (fn, ms = 150) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// Normaliza para busca sem diferenciar maiúsculas/acentos.
export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// UUID v4 (crypto.randomUUID só existe em contextos seguros; no celular via http da rede local não existe).
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// ---------- Avisos ----------
export function toast(message, type = 'info') {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${type}` }, icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info'), h('span', null, message));
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove(); // no máximo 3 avisos na tela
  setTimeout(() => el.remove(), type === 'error' ? 9000 : 5000);
}

// ---------- Diálogos (usam <dialog> nativo: foco preso, Esc e fundo escurecido) ----------
// `isDirty` permite avisar antes de descartar alterações.
export function createModal({ title, variant = 'modal', isDirty = () => false, onClosed }) {
  const dialog = h('dialog', { class: `dialog dialog-${variant}`, 'aria-labelledby': 'dialog-title' });
  const form = h('form', { class: 'dialog-form', novalidate: true });
  const body = h('div', { class: 'dialog-body' });
  const footer = h('div', { class: 'dialog-footer' });
  let closing = false;

  const close = () => {
    if (closing) return;
    closing = true;
    dialog.close();
    dialog.remove();
    window.removeEventListener('beforeunload', warn);
    onClosed?.();
  };
  const requestClose = async () => {
    if (isDirty() && !(await confirmDialog({
      title: 'Descartar alterações?',
      message: 'Você tem alterações que ainda não foram salvas. Se sair agora, elas serão perdidas.',
      confirmLabel: 'Descartar alterações',
      cancelLabel: 'Continuar editando',
      danger: true,
    }))) return;
    close();
  };
  const warn = (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);

  const closeBtn = h('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': 'Fechar', onclick: requestClose }, icon('x'));
  form.append(h('header', { class: 'dialog-header' }, h('h2', { id: 'dialog-title' }, title), closeBtn), body, footer);
  dialog.append(form);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
  dialog.addEventListener('mousedown', (e) => { dialog._downOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', (e) => { if (e.target === dialog && dialog._downOnBackdrop) requestClose(); });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, form, body, footer, close, requestClose };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog dialog-confirm', 'aria-labelledby': 'confirm-title', role: 'alertdialog' });
    const finish = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => finish(false) }, cancelLabel);
    const ok = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => finish(true) }, confirmLabel);
    dialog.append(h('div', { class: 'dialog-form' },
      h('div', { class: 'dialog-body' }, h('h2', { id: 'confirm-title' }, title), h('p', { class: 'muted' }, message)),
      h('div', { class: 'dialog-footer' }, cancel, ok)));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

// Mostra um botão em estado "ocupado" enquanto a promessa não termina, impedindo cliques repetidos.
export async function withBusy(button, label, fn) {
  if (button.disabled) return undefined;
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = label;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = original;
  }
}

// ---------- Campos de formulário ----------
export function field({ label, name, type = 'text', value = '', hint, required, attrs = {}, tag = 'input', children }) {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const control = h(tag, { id, name, ...(tag === 'input' && { type }), ...(tag === 'textarea' && { rows: 3 }), ...attrs }, children);
  control.value = value ?? '';
  const error = h('p', { class: 'field-error', id: `${id}-err`, hidden: true });
  const wrap = h('div', { class: 'field' },
    h('label', { for: id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    control,
    hint ? h('p', { class: 'field-hint' }, hint) : null,
    error);
  return {
    wrap, control,
    setError(msg) {
      error.hidden = !msg;
      error.textContent = msg ?? '';
      control.toggleAttribute('aria-invalid', !!msg);
      if (msg) control.setAttribute('aria-describedby', error.id); else control.removeAttribute('aria-describedby');
    },
  };
}

// Aplica erros de campo vindos do servidor; devolve true se algum foi mostrado.
export function showFieldErrors(fields, errors) {
  let first = true;
  let shown = false;
  for (const [name, f] of Object.entries(fields)) {
    f.setError(errors?.[name]);
    if (errors?.[name]) {
      shown = true;
      if (first) { f.control.focus(); first = false; }
    }
  }
  return shown;
}

export function banner(kind, text) {
  return h('div', { class: `banner banner-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, icon(kind === 'error' ? 'alert' : 'info'), h('span', null, text));
}
