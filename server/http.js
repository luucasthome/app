// Utilitários HTTP compartilhados: erros padronizados e limitador de tentativas.

export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const notFound = (what = 'Item') => new HttpError(404, 'not_found', `${what} não encontrado.`);

export function validationError(fields) {
  return new HttpError(400, 'validation', 'Revise os campos destacados.', fields);
}

export function createLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    // Retorna true quando a tentativa ainda é permitida.
    take(key) {
      const now = Date.now();
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      }
      let entry = hits.get(key);
      if (!entry || entry.reset <= now) {
        entry = { count: 0, reset: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return entry.count <= max;
    },
    clear: () => hits.clear(),
  };
}
