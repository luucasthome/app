import crypto from 'node:crypto';
import { Router } from 'express';
import {
  DUMMY_HASH,
  createSession,
  destroySession,
  hashPassword,
  hashToken,
  loadUser,
  newToken,
  verifyPassword,
} from '../auth.js';
import { HttpError, createLimiter, validationError } from '../http.js';
import { validateEmail, validateName, validatePassword } from '../validate.js';

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

export function authRouter({ db, config, mailer }) {
  const router = Router();
  const limits = {
    login: createLimiter({ windowMs: 15 * 60_000, max: 10 }),
    loginIp: createLimiter({ windowMs: 15 * 60_000, max: 60 }),
    register: createLimiter({ windowMs: 60 * 60_000, max: 20 }),
    forgot: createLimiter({ windowMs: 60 * 60_000, max: 10 }),
    reset: createLimiter({ windowMs: 60 * 60_000, max: 20 }),
  };
  const tooMany = () => new HttpError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  const check = (limiter, key) => {
    if (config.rateLimit && !limiter.take(key)) throw tooMany();
  };

  router.get('/me', (req, res) => {
    const user = loadUser(db, req);
    if (!user) throw new HttpError(401, 'unauthenticated', 'Você não está conectado.');
    res.json({ user: publicUser(user) });
  });

  router.post('/register', async (req, res) => {
    check(limits.register, req.ip);
    const name = validateName(req.body.name);
    const email = validateEmail(req.body.email);
    const password = validatePassword(req.body.password);
    const fields = {};
    if (name.error) fields.name = name.error;
    if (email.error) fields.email = email.error;
    if (password.error) fields.password = password.error;
    if (Object.keys(fields).length) throw validationError(fields);

    const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.value);
    if (exists) throw new HttpError(409, 'email_taken', 'Este e-mail já está cadastrado.', { email: 'Este e-mail já está cadastrado. Tente entrar.' });

    const user = { id: crypto.randomUUID(), name: name.value, email: email.value };
    const hash = await hashPassword(password.value);
    try {
      db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)').run(
        user.id,
        user.name,
        user.email,
        hash,
        new Date().toISOString(),
      );
    } catch (err) {
      // Dois cadastros simultâneos com o mesmo e-mail (ex.: clique repetido).
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) {
        throw new HttpError(409, 'email_taken', 'Este e-mail já está cadastrado.', { email: 'Este e-mail já está cadastrado. Tente entrar.' });
      }
      throw err;
    }
    createSession(db, config, res, user.id);
    res.status(201).json({ user: publicUser(user) });
  });

  router.post('/login', async (req, res) => {
    const email = validateEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const fields = {};
    if (email.error) fields.email = email.error;
    if (!password) fields.password = 'Informe sua senha.';
    if (Object.keys(fields).length) throw validationError(fields);

    check(limits.loginIp, req.ip);
    check(limits.login, `${req.ip}|${email.value}`);

    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.value);
    const ok = await verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok) throw new HttpError(401, 'bad_credentials', 'E-mail ou senha incorretos. Confira os dados ou use “Esqueci minha senha”.');

    createSession(db, config, res, row.id);
    res.json({ user: publicUser(row) });
  });

  router.post('/logout', (req, res) => {
    destroySession(db, config, req, res);
    res.status(204).end();
  });

  // Resposta idêntica exista ou não a conta, para não revelar quem está cadastrado.
  router.post('/forgot', (req, res) => {
    const email = validateEmail(req.body.email);
    if (email.error) throw validationError({ email: email.error });
    check(limits.forgot, req.ip);

    const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email.value);
    if (user) {
      const token = newToken();
      const expires = new Date(Date.now() + config.resetMinutes * 60_000).toISOString();
      db.transaction(() => {
        db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
        db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)').run(
          hashToken(token),
          user.id,
          expires,
        );
      })();
      const link = `${config.baseUrl}/#/redefinir?token=${encodeURIComponent(token)}`;
      mailer
        .send({
          to: user.email,
          subject: 'Redefinir sua senha — Follow',
          text:
            `Olá, ${user.name}!\n\nRecebemos um pedido para redefinir a senha da sua conta no Follow.\n` +
            `Para escolher uma nova senha, acesse o link abaixo (válido por ${config.resetMinutes} minutos):\n\n${link}\n\n` +
            'Se você não fez esse pedido, ignore esta mensagem: sua senha continua a mesma.',
        })
        .catch((err) => console.error('Falha ao enviar e-mail de recuperação:', err.message));
    }
    res.json({ message: 'Se este e-mail estiver cadastrado, enviamos um link para redefinir a senha.' });
  });

  router.post('/reset', async (req, res) => {
    check(limits.reset, req.ip);
    const password = validatePassword(req.body.password);
    if (password.error) throw validationError({ password: password.error });
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const invalid = new HttpError(400, 'invalid_token', 'Este link de recuperação é inválido ou expirou. Solicite um novo.');

    const row = token
      ? db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(hashToken(token))
      : null;
    if (!row || row.used_at || row.expires_at <= new Date().toISOString()) throw invalid;

    const hash = await hashPassword(password.value);
    const done = db.transaction(() => {
      // O UPDATE condicional garante que o link só funcione uma vez, mesmo com cliques simultâneos.
      const used = db
        .prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
        .run(new Date().toISOString(), row.token_hash);
      if (!used.changes) return false;
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
      return true;
    })();
    if (!done) throw invalid;
    res.json({ message: 'Senha redefinida. Entre com a nova senha.' });
  });

  return router;
}
