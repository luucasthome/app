import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export function hashSenha(senha) {
  const sal = randomBytes(16);
  return `scrypt$${sal.toString('hex')}$${scryptSync(senha, sal, 64).toString('hex')}`;
}

export function conferirSenha(senha, guardado) {
  const [alg, sal, hash] = String(guardado).split('$');
  if (alg !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'hex');
  const obtido = scryptSync(senha, Buffer.from(sal, 'hex'), esperado.length);
  return esperado.length === obtido.length && timingSafeEqual(esperado, obtido);
}

const b64 = (b) => Buffer.from(b).toString('base64url');

export function criarToken(usuario, segredo, validadeMs = 12 * 3600 * 1000, agora = Date.now()) {
  const corpo = b64(JSON.stringify({ u: usuario, exp: agora + validadeMs }));
  return `${corpo}.${createHmac('sha256', segredo).update(corpo).digest('base64url')}`;
}

export function lerToken(token, segredo, agora = Date.now()) {
  if (!token || !token.includes('.')) return null;
  const [corpo, assinatura] = token.split('.');
  const esperado = createHmac('sha256', segredo).update(corpo).digest('base64url');
  const a = Buffer.from(assinatura), b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return exp > agora ? u : null;
  } catch { return null; }
}

export function lerCookies(req) {
  const out = {};
  for (const par of String(req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return out;
}
