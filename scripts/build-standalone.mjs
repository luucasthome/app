// Gera standalone/follow.html: o Follow inteiro em UM arquivo HTML, que guarda os dados no navegador.
// Reaproveita a mesma interface (public/): só troca a camada de dados (api.js -> local-api.js).
// Uso: npm run build:standalone
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
// Evita que o conteúdo inline feche a tag <script>/<style> sem querer.
const safe = (code, tag) => code.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

const bundle = await build({
  entryPoints: [path.join(root, 'public/js/main.js')],
  bundle: true,
  write: false,
  format: 'iife',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  plugins: [{
    name: 'dados-locais',
    setup(b) {
      // Qualquer "import ... from './api.js'" passa a usar a versão que grava no navegador.
      b.onResolve({ filter: /\/api\.js$/ }, () => ({ path: path.join(root, 'public/js/local-api.js') }));
    },
  }],
});
const js = bundle.outputFiles[0].text;
const sortable = read('node_modules/sortablejs/Sortable.min.js');
const css = read('public/css/app.css');
const favicon = `data:image/svg+xml;base64,${Buffer.from(read('public/favicon.svg')).toString('base64')}`;

let html = read('public/index.html');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`Trecho não encontrado em index.html: ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="icon" href="/favicon.svg" type="image/svg+xml">', `<link rel="icon" href="${favicon}" type="image/svg+xml">`);
swap('<link rel="stylesheet" href="/css/app.css">', `<style>\n${safe(css, 'style')}\n</style>`);
swap('<script src="/vendor/sortable.min.js"></script>', `<script>${safe(sortable, 'script')}</script>`);
swap('<script type="module" src="/js/main.js"></script>', `<script>${safe(js, 'script')}</script>`);
html = html.replace('<!doctype html>', '<!doctype html>\n<!-- Gerado por scripts/build-standalone.mjs — não edite à mão. -->');

const out = path.join(root, 'standalone/follow.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`standalone/follow.html gerado (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
