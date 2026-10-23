// HTML dos cartões da TV. Usado pela TV e pela prévia na gestão, para ficarem idênticos.
import { rotuloPrazo, DIAS_SEMANA_CURTO, diaSemanaDe } from './tempo.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const svg = (corpo, tam = 30, extra = '') => `<svg aria-hidden="true" class="ico" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" ${extra}>${corpo}</svg>`;

export const ICONES = {
  urgente: (t) => svg('<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v5M12 17.5v.5"/>', t),
  atencao: (t) => svg('<path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z"/><path d="M12 8v5M12 15.5v.5"/>', t),
  info: (t) => svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', t),
  fixo: (t) => svg('<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 14v7"/>', t),
  ok: (t) => svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>', t),
  aberto: (t) => svg('<circle cx="12" cy="12" r="9"/>', t),
  bloqueio: (t) => svg('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', t),
  estrela: (t) => svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>', t),
  semrede: (t) => svg('<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5v.1M3 3l18 18"/>', t),
  vazio: (t) => svg('<path d="M4 4h16v16H4zM4 9h16"/>', t),
  alta: () => '<svg role="img" aria-label="Prioridade alta" class="ico" width="38" height="38" viewBox="0 0 24 24" fill="#f5f4f0" stroke="#f5f4f0" stroke-width="2" stroke-linejoin="round"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v5M12 17.5v.5" stroke="#0f0f0e" stroke-width="2.4"/></svg>',
  media: () => '<svg role="img" aria-label="Prioridade média" class="ico" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#f5f4f0" stroke-width="2.4"><path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z"/></svg>',
  baixa: () => '<svg role="img" aria-label="Prioridade baixa" class="ico" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#c9c8c2" stroke-width="2.4"><circle cx="12" cy="12" r="8"/></svg>'
};

export const ROTULO_PRIORIDADE_AVISO = { urgente: 'URGENTE', atencao: 'ATENÇÃO', info: 'INFORMATIVO' };
export const SETORES = ['Bar', 'Cozinha', 'Salão', 'Gerência'];
export const ETAPAS = { abertura: 'Abertura', operacao: 'Operação', fechamento: 'Fechamento' };

export function renderAviso(a) {
  const p = ROTULO_PRIORIDADE_AVISO[a.prioridade] ? a.prioridade : 'info';
  return `<article class="aviso aviso--${p}" data-id="${esc(a.id)}">
<div class="aviso__topo">${ICONES[p](30)}<span>${ROTULO_PRIORIDADE_AVISO[p]}</span>${a.fixado ? `<span class="aviso__fixo">${ICONES.fixo(26)}FIXADO</span>` : ''}</div>
<div class="aviso__titulo">${esc(a.titulo)}</div>
<div class="aviso__msg">${esc(a.mensagem)}</div>
</article>`;
}

export function renderReserva(r) {
  const chegou = r.status === 'chegou';
  const l1 = [r.nome, r.pessoas ? `${r.pessoas} ${r.pessoas === 1 ? 'pessoa' : 'pessoas'}` : ''].filter(Boolean).join(' · ');
  const l2 = [r.mesa, r.setor, r.obs].filter(Boolean).join(' · ');
  return `<div class="item reserva${chegou ? ' reserva--chegou' : ''}" data-id="${esc(r.id)}">
<div class="reserva__hora"><div class="hora">${esc(r.hora)}</div>${chegou ? '<div class="etiqueta etiqueta--cheia">CHEGOU</div>' : ''}</div>
<div class="item__corpo"><div class="item__titulo">${esc(l1)}</div>${l2 ? `<div class="item__sub">${esc(l2)}</div>` : ''}</div>
</div>`;
}

export function renderEvento(e, dia) {
  const hh = e.hora.endsWith(':00') ? `${e.hora.slice(0, 2).replace(/^0/, '')}H` : e.hora;
  const quando = e.data === dia ? 'HOJE' : DIAS_SEMANA_CURTO[diaSemanaDe(e.data)].toUpperCase();
  const sub = [e.nome, e.obs].filter(Boolean).join(' · ');
  return `<div class="evento" data-id="${esc(e.id)}">${ICONES.estrela(40)}<div class="item__corpo"><div class="item__titulo">PRÓXIMO EVENTO · ${esc(quando)} ${esc(hh)}</div><div class="item__sub">${esc(sub)}</div></div></div>`;
}

export function renderPendencia(p, agora = new Date()) {
  const prazo = p.prazo ? rotuloPrazo(p.prazo, agora) : '';
  const l2 = [p.setor, p.responsavel, prazo ? `até ${prazo}` : '', p.status === 'andamento' ? 'em andamento' : ''].filter(Boolean).join(' · ');
  const icone = ICONES[p.prioridade] ? ICONES[p.prioridade]() : ICONES.media();
  return `<div class="item pendencia${p.atrasada ? ' pendencia--atrasada' : ''}" data-id="${esc(p.id)}">
<div class="pendencia__prio">${icone}</div>
<div class="item__corpo"><div class="item__titulo">${esc(p.acao)}</div><div class="item__sub">${esc(l2)}</div></div>
<div class="pendencia__marcas">${p.atrasada ? '<div class="etiqueta etiqueta--cheia">ATRASADA</div>' : ''}${p.status === 'impedimento' ? `<div class="etiqueta etiqueta--vazada">${ICONES.bloqueio(22)}IMPEDIDA</div>` : ''}</div>
</div>`;
}

export function renderRotina(o) {
  const feita = o.status === 'concluida';
  const l2 = [ETAPAS[o.etapa] || '', o.setor, o.responsavel].filter(Boolean).join(' · ');
  return `<div class="item rotina${feita ? ' rotina--feita' : ''}" data-id="${esc(o.id)}">
<div class="rotina__estado">${feita ? ICONES.ok(34).replace('class="ico"', 'class="ico" role="img" aria-label="Concluída"') : ICONES.aberto(34).replace('class="ico"', 'class="ico" role="img" aria-label="Pendente"')}</div>
<div class="hora hora--rotina">${esc(o.hora)}</div>
<div class="item__corpo"><div class="item__titulo">${esc(o.nome)}</div><div class="item__sub">${esc(l2)}</div></div>
</div>`;
}

export function renderVazio(titulo = 'Nenhum item cadastrado', detalhe = '') {
  return `<div class="estado estado--vazio">${ICONES.vazio(48)}<div><div class="estado__titulo">${esc(titulo)}</div>${detalhe ? `<div class="estado__det">${esc(detalhe)}</div>` : ''}</div></div>`;
}

export function renderErro(detalhe = 'Pode haver itens que não estão aparecendo aqui. Confirme com a gerência.') {
  return `<div class="estado estado--erro">${ICONES.urgente(52)}<div><div class="estado__titulo">Não foi possível carregar</div><div class="estado__det">${esc(detalhe)}</div></div></div>`;
}
