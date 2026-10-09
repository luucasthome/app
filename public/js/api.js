// Cliente da API. Erros chegam como ApiError, já com mensagem em português.

// Na versão HTML única (standalone), este arquivo é substituído por local-api.js, onde LOCAL = true.
export const LOCAL = false;

export class ApiError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'network', 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* resposta sem corpo JSON */ }
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && e?.code === 'unauthenticated') onUnauthorized();
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Algo deu errado. Tente novamente.', e?.fields ?? {});
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);
