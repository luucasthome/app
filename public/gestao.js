import { dataSP, horaSP, diaOperacional, somarDias, diaSemanaDe, rotuloDia, DIAS_SEMANA_CURTO, MESES, diferencaDias } from '/shared/tempo.js';
import { avisoAtivo, pendenciaAtrasada } from '/shared/regras.js';
import { esc, renderAviso, renderReserva, renderEvento, renderPendencia, renderRotina, SETORES, ETAPAS } from '/shared/render.js';
import { spParaEpoch } from '/shared/tempo.js';

const app = document.getElementById('app');
const hoje = () => diaOperacional(new Date());
const IC = {
  voltar: '<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><path d="M15 5 8 12l7 7"/></svg>',
  ok: '<svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/></svg>',
  mais: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"><path d="M12 4v16M4 12h16"/></svg>',
  seta: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><path d="m9 5 7 7-7 7"/></svg>',
  esq: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><path d="M15 5 8 12l7 7"/></svg>',
  estrela: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/></svg>'
};

// ---------- API ----------
class ErroApi extends Error { constructor(status, msg, campos) { super(msg); this.status = status; this.campos = campos || {}; } }
async function api(metodo, url, corpo) {
  let r;
  try {
    r = await fetch(url, { method: metodo, headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : {}, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  } catch {
    document.getElementById('offline').hidden = false;
    throw new ErroApi(0, 'Sem conexão com o servidor.');
  }
  document.getElementById('offline').hidden = true;
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.endsWith('/login')) { sessao.usuario = null; location.hash = '#/login'; throw new ErroApi(401, 'Entre para continuar.'); }
  if (!r.ok) throw new ErroApi(r.status, dados.erro || 'Algo deu errado.', dados.campos);
  return dados;
}

const sessao = { usuario: null };
let toastTimer;
function toast(msg, acaoRotulo, acao) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${acaoRotulo ? `<button type="button">${esc(acaoRotulo)}</button>` : ''}`;
  t.hidden = false;
  if (acaoRotulo) t.querySelector('button').onclick = () => { t.hidden = true; acao(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, acaoRotulo ? 7000 : 4000);
}

// ---------- helpers de tela ----------
function tela(titulo, corpo, { voltar = '#/', extra = '' } = {}) {
  app.innerHTML = `<header class="g-topo">${voltar ? `<a class="g-voltar" href="${voltar}" aria-label="Voltar">${IC.voltar}</a>` : ''}<h1>${esc(titulo)}</h1>${extra}</header><main class="g-corpo">${corpo}</main>`;
  window.scrollTo(0, 0);
}
const fmtQuando = (iso) => {
  const d = new Date(iso);
  const dia = dataSP(d), h = diaOperacional(new Date());
  const rel = dia === dataSP(new Date()) ? 'Hoje' : diferencaDias(dataSP(new Date()), dia) === 1 ? 'Ontem' : `${dia.slice(8)}/${dia.slice(5, 7)}`;
  return `${rel} ${horaSP(d)}`;
};
const vazio = (txt = 'Nenhum item cadastrado') => `<div class="g-vazio">${esc(txt)}</div>`;
const falhou = () => '<div class="g-vazio g-vazio--erro">Não foi possível carregar. Confira a conexão e tente de novo.</div>';
const STATUS_RES = { confirmada: 'CONFIRMADA', chegou: 'CHEGOU', concluida: 'CONCLUÍDA', cancelada: 'CANCELADA' };
const STATUS_PEND = { pendente: 'Pendente', andamento: 'Em andamento', impedimento: 'Com impedimento', concluida: 'Concluída' };
const ROT_PRIO = { info: 'INFORMATIVO', atencao: 'ATENÇÃO', urgente: 'URGENTE' };
const PLURAL = { avisos: 'Aviso', reservas: 'Reserva', pendencias: 'Pendência', rotinas: 'Rotina' };
const rotaItem = (tipo, id) => `#/${tipo}/${id}`;

// ---------- Login ----------
function telaLogin() {
  app.innerHTML = `<div class="g-login"><div class="g-login__topo"><div class="g-faixa" aria-hidden="true"></div><div class="g-login__nome">BECO105</div><div class="g-marca"><small>MURAL DA EQUIPE · GESTÃO</small></div></div>
  <form id="f" class="g-corpo"><h2 class="g-t">Entrar</h2>
  <div class="g-campo"><label for="u">Usuário</label><input class="g-input" id="u" autocomplete="username" autocapitalize="none" required></div>
  <div class="g-campo"><label for="s">Senha</label><input class="g-input" id="s" type="password" autocomplete="current-password" required></div>
  <div id="m" class="g-erro" role="alert" hidden></div>
  <button class="g-btn g-btn--cheio g-btn--grande" type="submit">Entrar</button>
  <p class="g-ajuda">Acesso só para a gerência. A TV não pede senha e mostra apenas o que for publicado aqui.</p></form></div>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const m = document.getElementById('m');
    try {
      const r = await api('POST', '/api/login', { usuario: document.getElementById('u').value, senha: document.getElementById('s').value });
      sessao.usuario = r.usuario; location.hash = '#/';
    } catch (err) { m.textContent = err.message; m.hidden = false; }
  };
}

// ---------- Início ----------
async function telaHome() {
  tela('Gestão', '<div class="g-vazio">Carregando…</div>', { voltar: null, extra: '<a class="g-btn g-mini" style="background:transparent;color:#f5f4f0;border-color:#8a8a84" href="#/sair">Sair</a>' });
  try {
    const r = await api('GET', '/api/resumo');
    const atencao = r.atencao.length ? r.atencao.map((a) => `<a class="g-linha ${a.tipo === 'avisos' ? 'g-linha--tracejada' : ''}" href="${rotaItem(a.tipo, a.id)}"><span class="g-chip ${a.tipo === 'pendencias' ? 'g-chip--cheio' : ''}">${esc(a.rotulo)}</span><span class="g-linha__corpo">${esc(a.texto)}</span></a>`).join('') : vazio('Nada atrasado nem vencendo. Tudo em dia.');
    tela('Gestão', `
<div class="g-nav" style="gap:10px;font-weight:600;font-size:17px">${IC.ok}<span>Olá, ${esc(sessao.usuario)}. ${esc(rotuloDia(r.dia, r.dia))}.</span></div>
<section class="g-lista"><h2 class="g-t">O que você quer cadastrar?</h2>
<div class="g-home-grade">
<a class="g-home-btn" href="#/avisos"><svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"><path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z"/><path d="M12 8v5M12 15.5v.5"/></svg><div><b>Aviso</b><span>${r.avisos.ativos} na TV</span></div></a>
<a class="g-home-btn" href="#/reservas"><svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"><path d="M4 5h16v15H4zM4 10h16M8 3v4M16 3v4"/></svg><div><b>Reserva</b><span>${r.reservas.hoje} hoje${r.reservas.pessoas ? ` · ${r.reservas.pessoas} pessoas` : ''}</span></div></a>
<a class="g-home-btn" href="#/pendencias"><svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"><path d="M4 4h16v16H4z"/><path d="m8 12 3 3 5-6"/></svg><div><b>Pendência</b><span>${r.pendencias.abertas} abertas${r.pendencias.atrasadas ? ` · ${r.pendencias.atrasadas} atrasadas` : ''}</span></div></a>
<a class="g-home-btn" href="#/rotinas"><svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><div><b>Rotina</b><span>${r.rotinas.total} hoje · ${r.rotinas.feitas} feitas</span></div></a>
</div></section>
<section class="g-lista"><h2 class="g-t">Pede atenção agora</h2>${atencao}</section>
<section><a class="g-link" href="#/historico"><span>Concluídos e histórico</span>${IC.seta}</a><a class="g-link" href="#/arquivados"><span>Arquivados</span>${IC.seta}</a><a class="g-link" href="#/ajustes"><span>Ajustes da TV</span>${IC.seta}</a><a class="g-link" href="/tv" target="_blank" rel="noopener"><span>Abrir a TV neste aparelho</span>${IC.seta}</a></section>`, { voltar: null, extra: '<a class="g-btn g-mini" style="background:transparent;color:#f5f4f0;border-color:#8a8a84" href="#/sair">Sair</a>' });
  } catch (e) { if (e.status !== 401) tela('Gestão', falhou(), { voltar: null }); }
}

// ---------- Prévia da TV ----------
const LARGURA_NATURAL = { avisos: 576, reservas: 500, pendencias: 700, rotinas: 504 };
function montarPrevia(el, html, largura) {
  el.innerHTML = `<div class="g-previa__caixa"><div class="g-previa__escala tv" style="width:${largura}px">${html}</div></div>`;
  const caixa = el.firstElementChild, inner = caixa.firstElementChild;
  const escala = caixa.clientWidth / largura;
  inner.style.transform = `scale(${escala})`;
  caixa.style.height = `${inner.offsetHeight * escala}px`;
}

// ---------- Formulários ----------
const CAMPOS = {
  avisos: [
    { c: 'titulo', rot: 'Título curto', tipo: 'texto', max: 40 },
    { c: 'mensagem', rot: 'Mensagem', tipo: 'area', max: 100, ajuda: 'Mensagens curtas são lidas melhor na TV.' },
    { c: 'prioridade', rot: 'Prioridade', tipo: 'seg', opcoes: [['info', 'Informativo'], ['atencao', 'Atenção'], ['urgente', 'Urgente']] },
    { c: 'inicio', rot: 'Aparece a partir de', tipo: 'dt', ajuda: 'Vazio = já aparece.' },
    { c: 'fim', rot: 'Sai da TV em', tipo: 'dt', ajuda: 'Vazio = fica até você encerrar.' },
    { c: 'fixado', rot: 'Fixar na TV', tipo: 'check', ajuda: 'Tem preferência na hora de escolher os 3 avisos.' }
  ],
  reservas: [
    { c: 'tipo', rot: 'O que é?', tipo: 'seg', opcoes: [['reserva', 'Reserva'], ['evento', 'Evento (destaque na TV)']] },
    { c: 'data', rot: 'Data', tipo: 'data' },
    { c: 'hora', rot: 'Horário', tipo: 'hora' },
    { c: 'nome', rot: 'Primeiro nome ou identificação', tipo: 'texto', max: 30 },
    { c: 'pessoas', rot: 'Pessoas', tipo: 'numero', ajuda: 'Deixe vazio se não souber.' },
    { c: 'mesa', rot: 'Mesa', tipo: 'texto', max: 20, ajuda: 'Só se já estiver definida.' },
    { c: 'setor', rot: 'Setor', tipo: 'texto', max: 20 },
    { c: 'obs', rot: 'Observação operacional curta (aparece na TV)', tipo: 'texto', max: 50 },
    { c: 'status', rot: 'Status', tipo: 'seg', quebra: true, opcoes: [['confirmada', 'Confirmada'], ['chegou', 'Chegou'], ['concluida', 'Concluída'], ['cancelada', 'Cancelada']] },
    { c: 'contato', rot: 'Telefone ou e-mail (só aqui, nunca na TV)', tipo: 'texto', max: 80, privado: true },
    { c: 'notasPrivadas', rot: 'Observações pessoais (só aqui, nunca na TV)', tipo: 'area', max: 200, privado: true }
  ],
  pendencias: [
    { c: 'acao', rot: 'Ação', tipo: 'texto', max: 60 },
    { c: 'setor', rot: 'Setor', tipo: 'seg', quebra: true, opcoes: SETORES.map((s) => [s, s]) },
    { c: 'responsavel', rot: 'Responsável (uma pessoa)', tipo: 'resp' },
    { c: 'prazo', rot: 'Prazo', tipo: 'dt' },
    { c: 'prioridade', rot: 'Prioridade', tipo: 'seg', opcoes: [['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']] },
    { c: 'status', rot: 'Status', tipo: 'seg', quebra: true, opcoes: [['pendente', 'Pendente'], ['andamento', 'Em andamento'], ['impedimento', 'Com impedimento'], ['concluida', 'Concluída']] }
  ],
  rotinas: [
    { c: 'nome', rot: 'Nome da atividade', tipo: 'texto', max: 50 },
    { c: 'etapa', rot: 'Etapa', tipo: 'seg', opcoes: Object.entries(ETAPAS) },
    { c: 'setor', rot: 'Setor', tipo: 'seg', quebra: true, opcoes: SETORES.map((s) => [s, s]) },
    { c: 'responsavel', rot: 'Responsável', tipo: 'resp' },
    { c: 'dias', rot: 'Repete nos dias', tipo: 'dias' },
    { c: 'hora', rot: 'Horário', tipo: 'hora' }
  ]
};
const NOVO = {
  avisos: () => ({ titulo: '', mensagem: '', prioridade: 'info', inicio: '', fim: '', fixado: 0 }),
  reservas: (q) => ({ tipo: 'reserva', data: q.get('data') || hoje(), hora: '', nome: '', pessoas: '', mesa: '', setor: '', obs: '', status: 'confirmada', contato: '', notasPrivadas: '' }),
  pendencias: () => ({ acao: '', setor: 'Cozinha', responsavel: '', prazo: '', prioridade: 'media', status: 'pendente' }),
  rotinas: () => ({ nome: '', etapa: 'operacao', setor: 'Cozinha', responsavel: '', dias: '0,1,2,3,4,5,6', hora: '' })
};

function campoHTML(def, v, erro, responsaveis) {
  const id = `c_${def.c}`;
  const err = erro ? `<div class="g-erro" role="alert">${esc(erro)}</div>` : '';
  const ajuda = def.ajuda ? `<span class="g-ajuda">${esc(def.ajuda)}</span>` : '';
  switch (def.tipo) {
    case 'texto': return `<div class="g-campo"><label for="${id}">${esc(def.rot)}</label><input class="g-input" id="${id}" data-campo="${def.c}" maxlength="${def.max}" value="${esc(v)}" autocomplete="off">${ajuda}${err}</div>`;
    case 'area': return `<div class="g-campo"><label for="${id}">${esc(def.rot)}</label><textarea class="g-input" id="${id}" data-campo="${def.c}" rows="3" maxlength="${def.max}">${esc(v)}</textarea>${ajuda}${err}</div>`;
    case 'numero': return `<div class="g-campo"><label for="${id}">${esc(def.rot)}</label><input class="g-input" id="${id}" data-campo="${def.c}" type="number" inputmode="numeric" min="1" max="999" value="${esc(v ?? '')}">${ajuda}${err}</div>`;
    case 'dt': return `<div class="g-campo"><label for="${id}">${esc(def.rot)}</label><input class="g-input" id="${id}" data-campo="${def.c}" type="datetime-local" value="${esc(v || '')}">${ajuda}${err}</div>`;
    case 'data': return `<div class="g-campo"><label for="${id}">${esc(def.rot)}</label><input class="g-input" id="${id}" data-campo="${def.c}" type="date" value="${esc(v || '')}">${err}</div>`;
    case 'hora': return `<div class="g-campo"><label for="${id}">${esc(def.rot)}</label><input class="g-input" id="${id}" data-campo="${def.c}" type="time" value="${esc(v || '')}">${err}</div>`;
    case 'resp': return `<div class="g-campo"><label for="${id}">${esc(def.rot)}</label><input class="g-input" id="${id}" data-campo="${def.c}" maxlength="30" list="lista-resp" value="${esc(v)}" autocomplete="off"><datalist id="lista-resp">${responsaveis.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist>${err}</div>`;
    case 'check': return `<label class="g-check" for="${id}"><input type="checkbox" id="${id}" data-campo="${def.c}" ${v ? 'checked' : ''}><span>${esc(def.rot)}<small>${esc(def.ajuda || '')}</small></span></label>`;
    case 'seg': return `<fieldset class="g-campo"><legend>${esc(def.rot)}</legend><div class="g-seg ${def.quebra ? 'g-seg--quebra' : ''}" data-seg="${def.c}">${def.opcoes.map(([val, rot]) => `<button type="button" data-valor="${esc(val)}" aria-pressed="${String(v) === val}">${esc(rot)}</button>`).join('')}</div>${err}</fieldset>`;
    case 'dias': {
      const sel = String(v).split(',');
      return `<fieldset class="g-campo"><legend>${esc(def.rot)}</legend><div class="g-seg g-seg--dias" data-dias="${def.c}">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" data-dia="${d}" aria-pressed="${sel.includes(String(d))}" aria-label="${esc(DIAS_SEMANA_CURTO[d])}">${esc(DIAS_SEMANA_CURTO[d][0].toUpperCase() + DIAS_SEMANA_CURTO[d].slice(1))}</button>`).join('')}</div>${err}</fieldset>`;
    }
  }
  return '';
}

function previaHTML(ent, e) {
  const agora = new Date();
  if (ent === 'avisos') {
    const ativo = avisoAtivo({ ...e, arquivado: 0, inicio: e.inicio || null, fim: e.fim || null }, agora.getTime());
    const ini = e.inicio && spParaEpoch(e.inicio) > agora.getTime();
    const nota = ativo ? 'Aparece na TV agora.' : ini ? `Ainda não aparece: começa ${fmtQuando(new Date(spParaEpoch(e.inicio)).toISOString())}.` : 'Já venceu: não aparece na TV.';
    return { html: renderAviso({ ...e, id: 0, titulo: e.titulo || 'Título do aviso', mensagem: e.mensagem || 'Mensagem do aviso' }), nota };
  }
  if (ent === 'reservas') {
    if (e.tipo === 'evento') return { html: renderEvento({ id: 0, data: e.data || hoje(), hora: e.hora || '20:00', nome: e.nome || 'Nome do evento', obs: e.obs || '' }, hoje()), nota: 'Eventos aparecem em destaque embaixo das reservas.', largura: 500 };
    const nota = e.status === 'concluida' || e.status === 'cancelada' ? 'Concluída ou cancelada: sai da lista da TV.' : e.data && e.data !== hoje() ? 'A TV mostra só as reservas do dia.' : 'Aparece na lista de reservas de hoje.';
    return { html: renderReserva({ id: 0, hora: e.hora || '--:--', nome: e.nome || 'Nome', pessoas: e.pessoas ? Number(e.pessoas) : null, mesa: e.mesa, setor: e.setor, obs: e.obs, status: e.status }), nota };
  }
  if (ent === 'pendencias') {
    const atrasada = pendenciaAtrasada({ ...e, prazo: e.prazo || null }, agora.getTime());
    return { html: renderPendencia({ ...e, id: 0, acao: e.acao || 'Ação da pendência', responsavel: e.responsavel || 'Responsável', atrasada }, agora), nota: e.status === 'concluida' ? 'Concluída: sai das pendências da TV.' : atrasada ? 'Atrasada: continua visível com o rótulo “Atrasada”.' : 'Aparece nas pendências.' };
  }
  return { html: renderRotina({ id: 0, nome: e.nome || 'Atividade', setor: e.setor, responsavel: e.responsavel || 'Responsável', etapa: e.etapa, hora: e.hora || '--:--', status: 'pendente' }), nota: 'Cada dia ganha um registro próprio na lista da TV.' };
}

async function carregarResponsaveis() {
  try {
    const [p, r] = await Promise.all([api('GET', '/api/pendencias?estado=concluidos'), api('GET', '/api/rotinas')]);
    const a = await api('GET', '/api/pendencias');
    return [...new Set([...p, ...a, ...r].map((x) => x.responsavel).filter(Boolean))].sort();
  } catch { return []; }
}

const OCULTAR_NO_BANCO = new Set(['id', 'autor', 'criadoEm', 'atualizadoEm', 'arquivado', 'demo', 'concluidoEm', 'atrasada', 'hoje', 'ocorrencias']);

async function telaForm(ent, id, q) {
  const novo = id === 'novo';
  tela(`${novo ? 'Novo' : 'Editar'} ${PLURAL[ent].toLowerCase()}`, '<div class="g-vazio">Carregando…</div>', { voltar: `#/${ent}` });
  let item, responsaveis = [], hist = [];
  try {
    responsaveis = await carregarResponsaveis();
    if (!novo) { item = await api('GET', `/api/${ent}/${id}`); hist = await api('GET', `/api/historico?entidade=${ent}&id=${id}&limite=15`); }
  } catch (e) { if (e.status !== 401) tela('Erro', falhou(), { voltar: `#/${ent}` }); return; }

  const estado = novo ? NOVO[ent](q) : Object.fromEntries(CAMPOS[ent].map((d) => [d.c, item[d.c] ?? (d.tipo === 'check' ? 0 : '')]));
  let erros = {};
  const concluido = !novo && ((ent === 'pendencias' && item.status === 'concluida') || (ent === 'reservas' && ['concluida', 'cancelada'].includes(item.status)));
  const rotuloArquivar = !novo && item.arquivado ? 'Desarquivar' : 'Arquivar';

  const desenharCampos = () => document.getElementById('campos').innerHTML = CAMPOS[ent].map((d) => campoHTML(d, estado[d.c], erros[d.c], responsaveis)).join('');
  const desenharPrevia = () => {
    const p = previaHTML(ent, estado);
    const alvo = document.getElementById('previa');
    montarPrevia(alvo, p.html, p.largura || LARGURA_NATURAL[ent]);
    document.getElementById('previa-nota').textContent = p.nota;
  };

  const acoesTopo = !novo && !concluido ? (() => {
    if (ent === 'rotinas') return '';
    const rot = ent === 'avisos' ? 'Encerrar agora' : 'Concluir agora';
    return `<button class="g-btn g-btn--cheio g-btn--enorme" type="button" data-acao="concluir">${IC.ok}${rot}</button>`;
  })() : '';
  const reabrir = concluido ? '<button class="g-btn g-btn--cheio g-btn--grande" type="button" data-acao="reabrir">Reabrir</button>' : '';

  const rotinaOc = !novo && ent === 'rotinas' ? `<section class="g-lista"><h2 class="g-t">Ocorrências</h2>${item.ocorrencias.map((o) => {
    const rot = rotuloDia(o.dia, hoje());
    if (!o.status) return `<div class="g-linha g-linha--apagada"><span class="g-linha__corpo">${esc(rot)}<small>Esta rotina não acontece neste dia</small></span></div>`;
    const feita = o.status === 'concluida';
    const ehHoje = o.dia === hoje();
    return `<div class="g-linha ${ehHoje ? 'g-linha--forte' : feita ? 'g-linha--apagada' : ''}" style="flex-wrap:wrap"><span class="g-linha__corpo">${esc(rot)} · ${esc(item.hora)}<small>${feita ? `Concluída${o.concluidoPor ? ' por ' + esc(o.concluidoPor) : ''}` : 'Pendente'}</small></span><span class="g-chip ${feita ? 'g-chip--cheio' : ''}">${feita ? 'CONCLUÍDA' : 'PENDENTE'}</span>${ehHoje || o.dia < hoje() || !feita ? `<button class="g-btn ${feita ? '' : 'g-btn--cheio'} g-mini" type="button" data-acao="${feita ? 'reabrir-oc' : 'concluir-oc'}" data-dia="${o.dia}">${feita ? 'Reabrir' : ehHoje ? 'Concluir hoje' : 'Concluir'}</button>` : ''}</div>`;
  }).join('')}<p class="g-ajuda">Concluir hoje não conclui amanhã: cada dia tem seu próprio registro.</p></section>` : '';

  const historico = hist.length ? `<section class="g-lista"><h2 class="g-t">Histórico básico</h2><ul class="g-hist">${hist.map((h) => `<li><b>${esc(fmtQuando(h.em))}</b> · ${esc(h.autor)}<br>${esc(h.resumo)}</li>`).join('')}</ul></section>` : '';
  const ultima = !novo ? `<p class="g-ajuda">Última alteração: ${esc(item.autor)} · ${esc(fmtQuando(item.atualizadoEm))}</p>` : '';

  tela(`${novo ? 'Novo' : 'Editar'} ${PLURAL[ent].toLowerCase()}`, `
${acoesTopo}${reabrir}${rotinaOc}
<form id="form" class="g-corpo" style="padding:0" novalidate><div id="campos" class="g-corpo" style="padding:0"></div>
<section class="g-lista"><h2 class="g-t">Prévia na TV</h2><div class="g-previa" id="previa-moldura"><div id="previa"></div></div><p class="g-ajuda" id="previa-nota"></p></section>
<button class="g-btn g-btn--cheio g-btn--grande" type="submit" id="salvar">${novo ? 'Salvar e publicar' : 'Salvar alterações'}</button>
${novo ? '' : `<div class="g-duas"><button class="g-btn" type="button" data-acao="duplicar">Duplicar</button><button class="g-btn" type="button" data-acao="arquivar">${rotuloArquivar}</button></div>`}
</form>${ultima}${historico}`, { voltar: `#/${ent}` });

  desenharCampos(); desenharPrevia();
  const form = document.getElementById('form');

  const entrada = (ev) => {
    const el = ev.target.closest('[data-campo]');
    if (!el) return;
    estado[el.dataset.campo] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
    desenharPrevia();
  };
  form.addEventListener('input', entrada);
  form.addEventListener('change', entrada);
  form.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-valor], button[data-dia]');
    if (!b) return;
    if (b.dataset.valor !== undefined) {
      estado[b.parentElement.dataset.seg] = b.dataset.valor;
      b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    } else {
      const grupo = b.parentElement.dataset.dias;
      const sel = new Set(String(estado[grupo]).split(',').filter(Boolean));
      sel.has(b.dataset.dia) ? sel.delete(b.dataset.dia) : sel.add(b.dataset.dia);
      estado[grupo] = [...sel].join(',');
      b.setAttribute('aria-pressed', String(sel.has(b.dataset.dia)));
    }
    desenharPrevia();
  });

  const corpoParaEnvio = () => {
    const o = {};
    for (const d of CAMPOS[ent]) o[d.c] = d.tipo === 'check' ? estado[d.c] : (d.tipo === 'numero' ? (estado[d.c] === '' ? null : Number(estado[d.c])) : estado[d.c]);
    return o;
  };
  const ocupado = (v) => document.querySelectorAll('#app button').forEach((b) => { b.disabled = v; });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    ocupado(true);
    try {
      if (novo) await api('POST', `/api/${ent}`, corpoParaEnvio()); else await api('PUT', `/api/${ent}/${id}`, corpoParaEnvio());
      toast('Salvo. A TV atualiza em até 30 segundos.');
      location.hash = `#/${ent}`;
    } catch (e) {
      ocupado(false);
      if (e.campos && Object.keys(e.campos).length) { erros = e.campos; desenharCampos(); document.querySelector('.g-erro')?.scrollIntoView({ block: 'center' }); }
      toast(e.message);
    }
  });

  app.querySelectorAll('[data-acao]').forEach((b) => b.addEventListener('click', async () => {
    const acao = b.dataset.acao;
    ocupado(true);
    try {
      if (acao === 'concluir') {
        await api('POST', `/api/${ent}/${id}/concluir`, {});
        location.hash = `#/${ent}`;
        if (ent === 'avisos') toast('Aviso encerrado. Sai da TV em até 30 segundos.');
        else toast('Concluído.', 'Desfazer', async () => { try { await api('POST', `/api/${ent}/${id}/reabrir`, {}); toast('Reaberto.'); render(); } catch (e) { toast(e.message); } });
      } else if (acao === 'reabrir') { await api('POST', `/api/${ent}/${id}/reabrir`, {}); toast('Reaberto.'); render(); }
      else if (acao === 'concluir-oc' || acao === 'reabrir-oc') {
        await api('POST', `/api/rotinas/${id}/${acao === 'concluir-oc' ? 'concluir' : 'reabrir'}`, { dia: b.dataset.dia });
        toast(acao === 'concluir-oc' ? 'Ocorrência concluída. Os outros dias não mudam.' : 'Ocorrência reaberta.'); render();
      } else if (acao === 'duplicar') { const n = await api('POST', `/api/${ent}/${id}/duplicar`, {}); toast('Duplicado. Ajuste e salve.'); location.hash = `#/${ent}/${n.id}`; }
      else if (acao === 'arquivar') { await api('POST', `/api/${ent}/${id}/${item.arquivado ? 'desarquivar' : 'arquivar'}`, {}); toast(item.arquivado ? 'Tirado do arquivo.' : 'Arquivado.'); location.hash = `#/${ent}`; }
    } catch (e) { ocupado(false); toast(e.message); }
  }));
}

// ---------- Listas ----------
function abas(ent, atual, itens) {
  return `<div class="g-abas" role="tablist">${itens.map(([k, r]) => `<a href="#/${ent}?estado=${k}" ${k === atual ? 'aria-current="page"' : ''}>${esc(r)}</a>`).join('')}</div>`;
}
const novoBtn = (ent, extra = '') => `<a class="g-btn g-btn--cheio g-btn--grande" href="#/${ent}/novo${extra}">${IC.mais} Novo ${PLURAL[ent].toLowerCase()}</a>`;

async function telaLista(ent, q) {
  const estado = q.get('estado') || 'ativos';
  const titulos = { avisos: 'Avisos', pendencias: 'Pendências', rotinas: 'Rotinas' };
  tela(titulos[ent], '<div class="g-vazio">Carregando…</div>', { voltar: '#/' });
  let itens;
  try { itens = await api('GET', `/api/${ent}?estado=${estado}`); } catch (e) { if (e.status !== 401) tela(titulos[ent], falhou(), { voltar: '#/' }); return; }
  const agora = new Date();
  let linhas;
  if (ent === 'avisos') {
    linhas = itens.map((a) => `<a class="g-linha ${a.prioridade === 'urgente' ? 'g-linha--forte' : a.prioridade === 'atencao' ? 'g-linha--tracejada' : ''}" href="${rotaItem(ent, a.id)}"><span class="g-chip ${a.prioridade === 'urgente' ? 'g-chip--cheio' : ''}">${ROT_PRIO[a.prioridade]}</span><span class="g-linha__corpo">${esc(a.titulo)}<small>${a.fim ? `até ${esc(fmtQuando(new Date(spParaEpoch(a.fim)).toISOString()))}` : 'sem data de saída'}${a.fixado ? ' · FIXADO' : ''}</small></span></a>`);
  } else if (ent === 'pendencias') {
    linhas = itens.map((p) => `<a class="g-linha ${p.status === 'concluida' ? 'g-linha--apagada' : ''}" href="${rotaItem(ent, p.id)}"><span class="g-linha__corpo">${esc(p.acao)}<small>${esc(p.setor)} · ${esc(p.responsavel)}${p.prazo ? ` · até ${esc(fmtQuando(new Date(spParaEpoch(p.prazo)).toISOString()))}` : ''}</small></span><span class="g-chips">${p.atrasada ? '<span class="g-chip g-chip--cheio">ATRASADA</span>' : ''}<span class="g-chip">${esc(STATUS_PEND[p.status].toUpperCase())}</span></span></a>`);
  } else {
    linhas = itens.map((r) => `<a class="g-linha ${r.hoje?.status === 'concluida' ? 'g-linha--apagada' : ''}" href="${rotaItem(ent, r.id)}"><span class="g-linha__hora">${esc(r.hora)}</span><span class="g-linha__corpo">${esc(r.nome)}<small>${esc(ETAPAS[r.etapa])} · ${esc(r.setor)} · ${esc(r.responsavel)}</small></span>${r.hoje ? `<span class="g-chip ${r.hoje.status === 'concluida' ? 'g-chip--cheio' : ''}">HOJE: ${r.hoje.status === 'concluida' ? 'FEITA' : 'PENDENTE'}</span>` : ''}</a>`);
  }
  const opcoesAbas = { avisos: [['ativos', 'Ativos'], ['concluidos', 'Encerrados'], ['arquivados', 'Arquivados']], pendencias: [['ativos', 'Abertas'], ['concluidos', 'Concluídas'], ['arquivados', 'Arquivadas']], rotinas: [['ativos', 'Rotinas'], ['arquivados', 'Arquivadas']] }[ent];
  tela(titulos[ent], `${novoBtn(ent)}${abas(ent, estado, opcoesAbas)}<div class="g-lista">${linhas.length ? linhas.join('') : vazio()}</div>`, { voltar: '#/' });
}

// ---------- Reservas (dia, semana, mês) ----------
const resv = { visao: 'dia', ref: null };
const inicioSemana = (ymd) => somarDias(ymd, -((diaSemanaDe(ymd) + 6) % 7)); // segunda
function intervalo() {
  const ref = resv.ref;
  if (resv.visao === 'dia') return [ref, ref];
  if (resv.visao === 'semana') { const i = inicioSemana(ref); return [i, somarDias(i, 6)]; }
  const ini = `${ref.slice(0, 8)}01`;
  const prox = new Date(Date.UTC(+ref.slice(0, 4), +ref.slice(5, 7), 1));
  const fim = somarDias(`${prox.getUTCFullYear()}-${String(prox.getUTCMonth() + 1).padStart(2, '0')}-01`, -1);
  return [ini, fim];
}
const linhaReserva = (r) => {
  const evento = r.tipo === 'evento';
  const apagada = r.status === 'cancelada' || r.status === 'concluida';
  const sub = [r.mesa, r.setor, r.obs].filter(Boolean).join(' · ');
  return `<div class="g-linha ${evento ? 'g-linha--forte' : ''} ${apagada ? 'g-linha--apagada' : ''}" style="padding:0"><a href="${rotaItem('reservas', r.id)}" style="flex:1;min-width:0;display:flex;gap:12px;align-items:center;padding:8px 12px;text-decoration:none;color:inherit;min-height:60px"><span class="g-linha__hora">${esc(r.hora)}</span><span class="g-linha__corpo">${evento ? IC.estrela + ' ' : ''}${esc(r.nome)}${r.pessoas ? ` · ${r.pessoas} pessoas` : ''}${sub ? `<small>${esc(sub)}</small>` : ''}</span></a><span class="g-chips" style="padding-right:8px">${evento ? '<span class="g-chip">EVENTO</span>' : `<span class="g-chip ${r.status === 'chegou' ? 'g-chip--cheio' : ''}">${STATUS_RES[r.status]}</span>`}${r.status === 'confirmada' && !evento ? `<button class="g-btn g-mini" type="button" data-chegou="${r.id}">Chegou</button>` : ''}</span></div>`;
};
const resumoDia = (rs) => { const v = rs.filter((r) => r.tipo === 'reserva' && r.status !== 'cancelada'); return `${v.length} reserva${v.length === 1 ? '' : 's'}${v.some((r) => r.pessoas) ? ` · ${v.reduce((s, r) => s + (r.pessoas || 0), 0)} pessoas` : ''}`; };

async function telaReservas() {
  if (!resv.ref) resv.ref = hoje();
  tela('Reservas', '<div class="g-vazio">Carregando…</div>', { voltar: '#/' });
  const [de, ate] = intervalo();
  let itens;
  try { itens = await api('GET', `/api/reservas?estado=periodo&de=${de}&ate=${ate}`); } catch (e) { if (e.status !== 401) tela('Reservas', falhou(), { voltar: '#/' }); return; }
  const porDia = new Map();
  for (const r of itens) porDia.set(r.data, [...(porDia.get(r.data) || []), r]);
  const passo = (n) => resv.visao === 'dia' ? somarDias(resv.ref, n) : resv.visao === 'semana' ? somarDias(resv.ref, 7 * n) : (() => { const d = new Date(Date.UTC(+resv.ref.slice(0, 4), +resv.ref.slice(5, 7) - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; })();
  const rotuloPeriodo = resv.visao === 'dia' ? rotuloDia(resv.ref, hoje()) : resv.visao === 'semana' ? `${de.slice(8)}/${de.slice(5, 7)} a ${ate.slice(8)}/${ate.slice(5, 7)}` : `${MESES[+resv.ref.slice(5, 7) - 1]} de ${resv.ref.slice(0, 4)}`;
  let conteudo = '';
  if (resv.visao === 'mes') {
    const inicio = inicioSemana(de), celulas = [];
    for (let d = inicio; d <= somarDias(ate, (7 - ((diaSemanaDe(ate) + 6) % 7) - 1) % 7); d = somarDias(d, 1)) celulas.push(d);
    conteudo = `<div class="g-mes">${['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => `<div class="g-mes__cab">${d}</div>`).join('')}${celulas.map((d) => {
      if (d < de || d > ate) return '<button class="vazio" tabindex="-1" aria-hidden="true"></button>';
      const rs = porDia.get(d) || [], n = rs.filter((r) => r.tipo === 'reserva' && r.status !== 'cancelada').length, ev = rs.some((r) => r.tipo === 'evento');
      return `<button type="button" data-dia="${d}" class="${d === hoje() ? 'hoje' : ''}" aria-label="${esc(rotuloDia(d, hoje()))}: ${n} reservas">${+d.slice(8)}<small>${n ? n : '·'}${ev ? ' ★' : ''}</small></button>`;
    }).join('')}</div><p class="g-ajuda">O número é a quantidade de reservas; ★ marca evento. Toque num dia para abrir.</p>`;
  } else {
    const dias = resv.visao === 'dia' ? [resv.ref] : Array.from({ length: 7 }, (_, i) => somarDias(de, i));
    conteudo = dias.map((d) => { const rs = porDia.get(d) || []; return `<section class="g-lista"><h2 class="g-t g-t--linha">${esc(rotuloDia(d, hoje()))}<small>${rs.length ? esc(resumoDia(rs)) : 'Nenhum item cadastrado'}</small></h2>${rs.map(linhaReserva).join('')}</section>`; }).join('');
  }
  tela('Reservas', `<a class="g-btn g-btn--cheio g-btn--grande" href="#/reservas/novo?data=${resv.visao === 'dia' ? resv.ref : hoje()}">${IC.mais} Nova reserva</a>
<div class="g-abas" role="group" aria-label="Período">${[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']].map(([k, r]) => `<button type="button" data-visao="${k}" aria-pressed="${resv.visao === k}">${r}</button>`).join('')}</div>
<div class="g-nav"><button class="g-btn" type="button" data-passo="-1" aria-label="Anterior">${IC.esq}</button><strong>${esc(rotuloPeriodo)}</strong><button class="g-btn" type="button" data-passo="1" aria-label="Próximo">${IC.seta}</button></div>
<button class="g-btn g-mini" type="button" data-passo="0">Voltar para hoje</button>
${conteudo}<p class="g-ajuda">Telefone e observações pessoais ficam só na gestão. A TV mostra horário, nome curto, pessoas, mesa e observação operacional.</p>`, { voltar: '#/' });

  app.querySelectorAll('[data-visao]').forEach((b) => b.addEventListener('click', () => { resv.visao = b.dataset.visao; telaReservas(); }));
  app.querySelectorAll('[data-passo]').forEach((b) => b.addEventListener('click', () => { const n = Number(b.dataset.passo); resv.ref = n === 0 ? hoje() : passo(n); telaReservas(); }));
  app.querySelectorAll('[data-dia]').forEach((b) => b.addEventListener('click', () => { resv.visao = 'dia'; resv.ref = b.dataset.dia; telaReservas(); }));
  app.querySelectorAll('[data-chegou]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('PUT', `/api/reservas/${b.dataset.chegou}`, { status: 'chegou' }); toast('Marcado como chegou.'); telaReservas(); } catch (e) { b.disabled = false; toast(e.message); }
  }));
}

// ---------- Histórico, arquivados, ajustes ----------
async function telaHistorico(q) {
  const aba = q.get('aba') || 'concluidos';
  tela('Concluídos e histórico', '<div class="g-vazio">Carregando…</div>', { voltar: '#/' });
  let itens;
  try { itens = await api('GET', aba === 'concluidos' ? '/api/concluidos' : '/api/historico?limite=60'); } catch (e) { if (e.status !== 401) tela('Histórico', falhou(), { voltar: '#/' }); return; }
  const tabs = `<div class="g-abas"><a href="#/historico?aba=concluidos" ${aba === 'concluidos' ? 'aria-current="page"' : ''}>Concluídos</a><a href="#/historico?aba=alteracoes" ${aba === 'alteracoes' ? 'aria-current="page"' : ''}>Alterações</a></div>`;
  const nomeTipo = { avisos: 'Aviso', reservas: 'Reserva', pendencias: 'Pendência', rotinas: 'Rotina' };
  const lista = aba === 'concluidos'
    ? (itens.length ? itens.map((i) => `<a class="g-linha g-linha--apagada" href="${rotaItem(i.tipo, i.id)}"><span class="g-chip">${esc(nomeTipo[i.tipo].toUpperCase())}</span><span class="g-linha__corpo">${esc(i.titulo)}<small>${esc(fmtQuando(i.em))}${i.estado === 'cancelada' ? ' · cancelada' : ''}</small></span></a>`).join('') : vazio())
    : (itens.length ? `<ul class="g-hist">${itens.map((h) => `<li><b>${esc(fmtQuando(h.em))}</b> · ${esc(h.autor)} · ${esc(nomeTipo[h.entidade] || h.entidade)} #${h.entidadeId}<br>${esc(h.resumo)}</li>`).join('')}</ul>` : vazio());
  tela('Concluídos e histórico', `${tabs}<div class="g-lista">${lista}</div>`, { voltar: '#/' });
}

async function telaArquivados() {
  tela('Arquivados', '<div class="g-vazio">Carregando…</div>', { voltar: '#/' });
  try {
    const grupos = await Promise.all(['avisos', 'reservas', 'pendencias', 'rotinas'].map(async (t) => [t, await api('GET', `/api/${t}?estado=arquivados`)]));
    const tit = { avisos: (x) => x.titulo, reservas: (x) => `${x.nome} · ${x.data.slice(8)}/${x.data.slice(5, 7)}`, pendencias: (x) => x.acao, rotinas: (x) => x.nome };
    const corpo = grupos.map(([t, xs]) => `<section class="g-lista"><h2 class="g-t">${esc(PLURAL[t])}s</h2>${xs.length ? xs.map((x) => `<a class="g-linha g-linha--apagada" href="${rotaItem(t, x.id)}"><span class="g-linha__corpo">${esc(tit[t](x))}</span><span class="g-chip">ABRIR</span></a>`).join('') : vazio()}</section>`).join('');
    tela('Arquivados', corpo, { voltar: '#/' });
  } catch (e) { if (e.status !== 401) tela('Arquivados', falhou(), { voltar: '#/' }); }
}

async function telaAjustes() {
  tela('Ajustes da TV', '<div class="g-vazio">Carregando…</div>', { voltar: '#/' });
  let cfg;
  try { cfg = await api('GET', '/api/config'); } catch (e) { if (e.status !== 401) tela('Ajustes', falhou(), { voltar: '#/' }); return; }
  tela('Ajustes da TV', `<form id="aj" class="g-corpo" style="padding:0" novalidate>
<div class="g-campo"><label for="seg">Segundos em cada página</label><input class="g-input" id="seg" type="number" inputmode="numeric" min="10" max="120" value="${cfg.paginaSegundos}"><span class="g-ajuda">De 10 a 120. A TV pega a mudança na próxima sincronização.</span></div>
<h2 class="g-t">Turnos</h2>${cfg.turnos.map((t, i) => `<div class="g-campo"><span class="g-rotulo">Turno ${i + 1}</span><div class="g-duas" style="grid-template-columns:2fr 1fr 1fr"><input class="g-input" aria-label="Nome do turno ${i + 1}" data-t="${i}" data-k="nome" value="${esc(t.nome)}" maxlength="30"><input class="g-input" aria-label="Início do turno ${i + 1}" data-t="${i}" data-k="inicio" type="time" value="${esc(t.inicio)}"><input class="g-input" aria-label="Fim do turno ${i + 1}" data-t="${i}" data-k="fim" type="time" value="${esc(t.fim)}"></div></div>`).join('')}
<p class="g-ajuda">O cabeçalho da TV mostra “Turno …” com o nome. O dia operacional vira às 05h: o turno da noite que passa da meia-noite continua no mesmo dia.</p>
<button class="g-btn g-btn--cheio g-btn--grande" type="submit">Salvar ajustes</button></form>
<div class="g-demo">TV: abra <b>${esc(location.origin)}/tv</b> no navegador da TV e aperte F para tela cheia.</div>`, { voltar: '#/' });
  document.getElementById('aj').onsubmit = async (e) => {
    e.preventDefault();
    const turnos = cfg.turnos.map((t) => ({ ...t }));
    app.querySelectorAll('[data-t]').forEach((el) => { turnos[+el.dataset.t][el.dataset.k] = el.value; });
    try { await api('PUT', '/api/config', { paginaSegundos: Number(document.getElementById('seg').value), turnos }); toast('Ajustes salvos.'); location.hash = '#/'; } catch (err) { toast(err.message); }
  };
}

// ---------- roteador ----------
async function render() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [caminho, qs] = hash.split('?');
  const q = new URLSearchParams(qs || '');
  const partes = caminho.split('/').filter(Boolean);
  if (!sessao.usuario && caminho !== '/login') {
    try { sessao.usuario = (await api('GET', '/api/eu')).usuario; } catch { location.hash = '#/login'; return telaLogin(); }
  }
  if (caminho === '/login') return sessao.usuario ? (location.hash = '#/') : telaLogin();
  if (caminho === '/sair') { await api('POST', '/api/logout', {}).catch(() => {}); sessao.usuario = null; location.hash = '#/login'; return; }
  if (!partes.length) return telaHome();
  const [ent, id] = partes;
  if (ent === 'reservas' && !id) return telaReservas();
  if (['avisos', 'pendencias', 'rotinas'].includes(ent) && !id) return telaLista(ent, q);
  if (['avisos', 'reservas', 'pendencias', 'rotinas'].includes(ent) && id) return telaForm(ent, id, q);
  if (ent === 'historico') return telaHistorico(q);
  if (ent === 'arquivados') return telaArquivados();
  if (ent === 'ajustes') return telaAjustes();
  location.hash = '#/';
}
window.addEventListener('hashchange', render);
render();
