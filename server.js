import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco, segredoSessao } from './src/db.js';
import { criarApi } from './src/api.js';
import { hashSenha } from './src/auth.js';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json'
};
const PAGINAS = { '/tv': 'tv.html', '/gestao': 'gestao.html' };
const SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
};

export function criarApp({ db = abrirBanco(), agora = () => new Date() } = {}) {
  const api = criarApi({ db, segredo: segredoSessao(db), agora });

  async function estatico(res, caminhoRel) {
    const compartilhado = caminhoRel.startsWith('shared/');
    const base = join(RAIZ, compartilhado ? 'shared' : 'public');
    const alvo = normalize(join(base, compartilhado ? caminhoRel.slice(7) : caminhoRel));
    if (!alvo.startsWith(base + '/')) { res.writeHead(403); return res.end(); }
    try {
      const st = await stat(alvo);
      if (!st.isFile()) throw new Error('nao arquivo');
      const dados = await readFile(alvo);
      const ext = extname(alvo);
      res.writeHead(200, {
        'Content-Type': TIPOS[ext] || 'application/octet-stream',
        // HTML/JS/CSS sempre revalidados (a TV pega correções sozinha); fontes podem ficar em cache
        'Cache-Control': ext === '.woff2' ? 'public, max-age=2592000' : 'no-cache',
        ...SEGURANCA
      });
      res.end(dados);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
    }
  }

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return api.handler(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/gestao' }); return res.end(); }
    const pagina = PAGINAS[url.pathname.replace(/\/$/, '')];
    return estatico(res, pagina || url.pathname.slice(1));
  });
  return { servidor, db, api };
}

// Execução direta: node server.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const porta = Number(process.env.PORT) || 3000;
  const { servidor, db } = criarApp();
  if (!db.prepare('SELECT 1 FROM usuarios LIMIT 1').get()) {
    if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
      db.prepare('INSERT INTO usuarios (nome, hash, criadoEm) VALUES (?,?,?)').run(process.env.ADMIN_USER, hashSenha(process.env.ADMIN_PASSWORD), new Date().toISOString());
      console.log(`Usuário "${process.env.ADMIN_USER}" criado a partir de ADMIN_USER/ADMIN_PASSWORD.`);
    } else {
      console.warn('ATENÇÃO: nenhum usuário cadastrado. Crie um com: npm run usuario -- <nome> <senha>');
    }
  }
  servidor.listen(porta, process.env.HOST || '0.0.0.0', () => {
    console.log(`Mural Beco105 no ar: TV em http://localhost:${porta}/tv · Gestão em http://localhost:${porta}/gestao`);
  });
  for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => { servidor.close(); db.close(); process.exit(0); });
}
