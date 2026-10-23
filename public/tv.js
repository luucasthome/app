import { formatarDataLonga, turnoAtual, horaSP } from '/shared/tempo.js';
import { selecionarAvisos, pendenciasAbertas } from '/shared/regras.js';
import { paginarPorAltura, paginaDaColuna } from '/shared/paginacao.js';
import { renderAviso, renderReserva, renderEvento, renderPendencia, renderRotina, renderVazio, renderErro, ICONES, esc } from '/shared/render.js';

// Parâmetros só para diagnóstico/testes: /tv?poll=3&stale=10 (segundos)
const params = new URLSearchParams(location.search);
const seg = (nome, padrao) => { const n = Number(params.get(nome)); return n > 0 ? n * 1000 : padrao; };
const POLL_MS = seg('poll', 15000);      // consulta ao servidor (meta: alteração visível em até 30 s)
const TIMEOUT_MS = 8000;
const STALE_MS = seg('stale', 60000);    // sem sincronizar há mais que isso => "dados desatualizados"
const CACHE_KEY = 'beco105.tv.ultimo';
const GAP = 8;

const $ = (id) => document.getElementById(id);
const stage = $('stage');

let dados = null;           // último payload bom
let offsetMs = 0;           // relógio do servidor - relógio local
let ultimoOkLocal = 0;      // Date.now() da última sincronização bem-sucedida
let pagina = 0;
let timerPagina = null;
let segundosPagina = 25;
const anterior = {};        // HTML já aplicado em cada região (evita piscar)

// ---------- escala 16:9 (4K = mesmo layout em 2x) ----------
function escalar() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const x = (window.innerWidth - 1920 * s) / 2, y = (window.innerHeight - 1080 * s) / 2;
  stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
}
window.addEventListener('resize', escalar);
escalar();

// ---------- sincronização ----------
function lerCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.geradoEm) return c;
  } catch { /* sem cache */ }
  return null;
}

async function sincronizar() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch('/api/tv', { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const novo = await r.json();
    if (!novo || !novo.geradoEm) throw new Error('resposta inválida');
    dados = novo;
    offsetMs = Date.parse(novo.geradoEm) - Date.now();
    ultimoOkLocal = Date.now();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(novo)); } catch { /* cache é só reforço */ }
    if (novo.config?.paginaSegundos !== segundosPagina) { segundosPagina = novo.config.paginaSegundos; reiniciarTimer(); }
  } catch {
    /* mantém o último conteúdo; o aviso de desatualização aparece pelo relógio */
  } finally {
    clearTimeout(t);
    desenhar();
    setTimeout(sincronizar, POLL_MS);
  }
}

// ---------- desenho ----------
function aplicar(chave, el, html, fade) {
  if (anterior[chave] === html) return false;
  anterior[chave] = html;
  if (fade) {
    el.classList.add('some');
    setTimeout(() => { el.innerHTML = html; el.classList.remove('some'); }, 350);
  } else {
    el.innerHTML = html;
  }
  return true;
}

function medir(lista, htmls) {
  const m = document.createElement('div');
  m.className = 'lista medidor';
  m.style.width = `${lista.clientWidth}px`;
  m.innerHTML = htmls.join('');
  lista.parentNode.appendChild(m);
  const alturas = [...m.children].map((c) => c.offsetHeight);
  m.remove();
  return alturas;
}

function colunaPaginas(lista, itens) {
  if (!itens.length) return [[]];
  const alturas = medir(lista, itens.map((i) => i.html));
  return paginarPorAltura(itens.map((i, n) => ({ h: alturas[n], critico: i.critico })), lista.clientHeight, GAP);
}

function rotuloTurno(t) {
  if (!t) return 'Fora de turno';
  const h = (s) => s.endsWith(':00') ? `${+s.slice(0, 2)}h` : `${+s.slice(0, 2)}h${s.slice(3)}`;
  return `Turno ${t.nome} · ${h(t.inicio)} às ${h(t.fim)}`;
}

let desenhando = false;
function desenhar({ fade = false } = {}) {
  if (desenhando) return;
  desenhando = true;
  try { desenharInterno(fade); } finally { desenhando = false; }
}

function desenharInterno(fade) {
  const erroTotal = $('tela-erro');
  if (!dados) { erroTotal.classList.add('on'); stage.style.visibility = 'hidden'; return; }
  erroTotal.classList.remove('on'); stage.style.visibility = 'visible';

  const agora = new Date(Date.now() + offsetMs);
  const agoraMs = agora.getTime();
  const sec = dados.secoes || {};

  // Cabeçalho
  aplicar('dia', $('cab-dia'), esc(formatarDataLonga(agora)));
  aplicar('turno', $('cab-turno'), esc(rotuloTurno(turnoAtual(dados.config?.turnos, agora))));

  // Atenção hoje: avisos vencidos somem mesmo sem nova sincronização
  let htmlAvisos;
  if (sec.avisos === 'erro') htmlAvisos = renderErro();
  else {
    const { avisos } = selecionarAvisos(dados.avisos.map((a) => ({ ...a, inicio: null })), agoraMs, 3);
    htmlAvisos = avisos.length ? avisos.map(renderAviso).join('') : renderVazio('Nenhum item cadastrado', 'Sem avisos ativos agora.');
  }
  aplicar('avisos', $('avisos'), htmlAvisos);

  // Evento em destaque
  aplicar('evento', $('evento'), sec.reservas === 'ok' && dados.evento ? renderEvento(dados.evento, dados.dia) : '');

  // Faixa de dados desatualizados
  const idade = Date.now() - ultimoOkLocal;
  const stale = idade > STALE_MS;
  const faixa = $('faixa-stale');
  const hSync = horaSP(new Date(dados.geradoEm));
  const minutos = Math.max(1, Math.floor(idade / 60000));
  const quando = idade < 90000 ? `há ${Math.max(1, Math.round(idade / 1000))} s` : `há ${minutos} min`;
  faixa.classList.toggle('on', stale);
  aplicar('faixa', faixa, stale ? `${ICONES.semrede(34)}<span>DADOS DESATUALIZADOS · última sincronização às ${hSync} (${quando}) · tentando reconectar</span>` : '');

  // Colunas
  const colReservas = {
    lista: $('lista-reservas'), status: sec.reservas,
    itens: dados.reservas.map((r) => ({ html: renderReserva(r) }))
  };
  const colPend = {
    lista: $('lista-pendencias'), status: sec.pendencias,
    itens: pendenciasAbertas(dados.pendencias.map((p) => ({ ...p })), agoraMs).map((p) => ({ html: renderPendencia(p, agora), critico: p.critica }))
  };
  const colRot = {
    lista: $('lista-rotinas'), status: sec.rotinas,
    itens: dados.rotinas.map((o) => ({ html: renderRotina(o) }))
  };
  const colunas = [['reservas', colReservas, $('cnt-reservas')], ['pendencias', colPend, $('cnt-pendencias')], ['rotinas', colRot, $('cnt-rotinas')]];

  const info = colunas.map(([nome, c, cnt]) => {
    if (c.status === 'erro') return { nome, c, cnt, erro: true, paginas: [[]] };
    return { nome, c, cnt, erro: false, paginas: colunaPaginas(c.lista, c.itens) };
  });
  const total = Math.max(1, ...info.map((i) => i.paginas.length));
  if (pagina >= total) pagina = 0;

  for (const i of info) {
    let html;
    if (i.erro) html = renderErro();
    else if (!i.c.itens.length) html = renderVazio('Nenhum item cadastrado');
    else html = paginaDaColuna(i.paginas, pagina).map((n) => i.c.itens[n].html).join('');
    aplicar(`lista-${i.nome}`, i.c.lista, html, fade && i.paginas.length > 1);
    const n = i.c.itens.length;
    aplicar(`cnt-${i.nome}`, i.cnt, i.erro ? 'sem dados' : `${n} ${n === 1 ? 'item' : 'itens'}`);
  }

  // Rodapé
  aplicar('sync', $('rodape-sync'), stale
    ? `${ICONES.semrede(30)}<span>Última sincronização bem-sucedida: ${hSync} · sem conexão</span>`
    : `${ICONES.ok(30)}<span>Última sincronização: ${hSync}</span>`);
  aplicar('demo', $('rodape-demo'), dados.demo ? '<div class="rodape__demo">DADOS DE DEMONSTRAÇÃO</div>' : '');
  aplicar('pag', $('rodape-pag'), `Página ${pagina + 1} de ${total}`);
  aplicar('pontos', $('pontos'), Array.from({ length: total }, (_, n) => `<span class="ponto${n === pagina ? ' on' : ''}"></span>`).join(''));
  window.__tv = { total, pagina, stale };
}

function proximaPagina() {
  const total = window.__tv?.total || 1;
  if (total > 1) { pagina = (pagina + 1) % total; desenhar({ fade: true }); }
}
function reiniciarTimer() {
  clearInterval(timerPagina);
  timerPagina = setInterval(proximaPagina, Math.max(5, segundosPagina) * 1000);
}

// relógio: atualiza data/turno/desatualizado sem refazer o que não mudou
setInterval(() => desenhar(), 5000);

// F alterna tela cheia (o navegador só permite após um toque/tecla)
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
  }
});

// início: mostra o último conteúdo guardado (se houver) já marcado como desatualizado até sincronizar
const cache = lerCache();
if (cache) { dados = cache; offsetMs = 0; ultimoOkLocal = Date.parse(cache.geradoEm) || 0; segundosPagina = cache.config?.paginaSegundos || 25; }
(document.fonts?.ready || Promise.resolve()).then(() => { desenhar(); sincronizar(); reiniciarTimer(); });
document.fonts?.addEventListener?.('loadingdone', () => desenhar());
