import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const COOKIE = 'sid';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, n, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return crypto.timingSafeEqual(key, expected);
}

// Hash "falso" usado para gastar o mesmo tempo quando o e-mail não existe.
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(8).toString('hex'));

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(db, config, res, userId) {
  const token = newToken();
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionDays * 86400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').run(
    hashToken(token),
    userId,
    expires.toISOString(),
    now.toISOString(),
  );
  res.cookie(COOKIE, token, cookieOptions(config, expires));
}

export function cookieOptions(config, expires) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production || config.baseUrl.startsWith('https://'),
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

export function destroySession(db, config, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(COOKIE, cookieOptions(config));
}

// Carrega o usuário a partir do cookie de sessão (ou null).
export function loadUser(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(hashToken(token));
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  return { id: row.id, name: row.name, email: row.email };
}

export function requireUser(db) {
  return (req, _res, next) => {
    const user = loadUser(db, req);
    if (!user) return next(new HttpError(401, 'unauthenticated', 'Sua sessão expirou. Entre novamente.'));
    req.user = user;
    next();
  };
}
