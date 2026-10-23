// Regras de exibição da TV (funções puras, testáveis).
import { spParaEpoch, diaOperacional, minutosOp, horaNoTurno, horaSP, localSP } from './tempo.js';

export const RANK_AVISO = { urgente: 0, atencao: 1, info: 2 };
export const RANK_PRIORIDADE = { alta: 0, media: 1, baixa: 2 };

/** Aviso dentro da janela de exibição e não arquivado. Início/fim vazios = sem limite. */
export function avisoAtivo(a, agoraMs) {
  if (a.arquivado) return false;
  if (a.inicio) { const i = spParaEpoch(a.inicio); if (!Number.isNaN(i) && i > agoraMs) return false; }
  if (a.fim) { const f = spParaEpoch(a.fim); if (!Number.isNaN(f) && f <= agoraMs) return false; }
  return true;
}

/** Urgentes sempre primeiro; depois os fixados; depois por prioridade e alteração mais recente. */
export function ordenarAvisos(avisos) {
  const chave = (a) => (a.prioridade === 'urgente' ? 0 : a.fixado ? 1 : 2 + RANK_AVISO[a.prioridade]);
  return [...avisos].sort((x, y) => chave(x) - chave(y)
    || String(y.atualizadoEm || '').localeCompare(String(x.atualizadoEm || '')));
}

export function selecionarAvisos(avisos, agoraMs, max = 3) {
  const ativos = ordenarAvisos(avisos.filter((a) => avisoAtivo(a, agoraMs)));
  return { avisos: ativos.slice(0, max), excedente: Math.max(0, ativos.length - max) };
}

const reservaViva = (r) => !r.arquivado && (r.status === 'confirmada' || r.status === 'chegou');

export function reservasDoDia(reservas, dia) {
  return reservas
    .filter((r) => (r.tipo || 'reserva') === 'reserva' && r.data === dia && reservaViva(r))
    .sort((a, b) => minutosOp(a.hora) - minutosOp(b.hora) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Próximo evento cadastrado (hoje ou depois) ainda não concluído nem cancelado. */
export function proximoEvento(reservas, dia) {
  return reservas
    .filter((r) => r.tipo === 'evento' && r.data >= dia && reservaViva(r))
    .sort((a, b) => a.data.localeCompare(b.data) || minutosOp(a.hora) - minutosOp(b.hora))[0] || null;
}

export function pendenciaAtrasada(p, agoraMs) {
  if (p.status === 'concluida' || !p.prazo) return false;
  const t = spParaEpoch(p.prazo);
  return !Number.isNaN(t) && t < agoraMs;
}

export const pendenciaCritica = (p, agoraMs) => pendenciaAtrasada(p, agoraMs) || p.prioridade === 'alta';

/** Abertas, atrasadas e de prioridade alta primeiro, depois prazo mais próximo. Sem prazo vai por último. */
export function pendenciasAbertas(pendencias, agoraMs) {
  const abertas = pendencias.filter((p) => !p.arquivado && p.status !== 'concluida');
  const prazoMs = (p) => { const t = p.prazo ? spParaEpoch(p.prazo) : NaN; return Number.isNaN(t) ? Infinity : t; };
  return abertas
    .map((p) => ({ ...p, atrasada: pendenciaAtrasada(p, agoraMs), critica: pendenciaCritica(p, agoraMs) }))
    .sort((a, b) => (b.critica - a.critica)
      || (b.atrasada - a.atrasada)
      || RANK_PRIORIDADE[a.prioridade] - RANK_PRIORIDADE[b.prioridade]
      || prazoMs(a) - prazoMs(b));
}

/**
 * Ocorrências de rotina do dia operacional.
 * Visíveis: pendentes atrasadas (nunca somem) e as do turno atual; concluídas do turno vão ao fim.
 */
export function rotinasParaTv(ocorrencias, agora, turno) {
  const hora = horaSP(agora);
  const agoraMin = minutosOp(hora);
  const doTurno = (o) => !turno || horaNoTurno(o.hora, turno);
  const lista = ocorrencias.filter((o) => {
    if (o.status === 'concluida') return doTurno(o);
    return minutosOp(o.hora) < agoraMin || doTurno(o);
  });
  const ordem = (o) => (o.status === 'concluida' ? 1 : 0);
  return lista.sort((a, b) => ordem(a) - ordem(b) || minutosOp(a.hora) - minutosOp(b.hora) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Monta o que a TV recebe. Nada de contato ou notas privadas passa por aqui. */
export function montarTv({ avisos, reservas, pendencias, ocorrencias, turnos, config }, agora, status = {}) {
  const agoraMs = agora.getTime();
  const dia = diaOperacional(agora);
  const turno = (turnos || []).find((t) => horaNoTurno(horaSP(agora), t)) || null;
  const secoes = { avisos: 'ok', reservas: 'ok', pendencias: 'ok', rotinas: 'ok', ...status };
  const sel = selecionarAvisos(avisos || [], agoraMs);
  const evento = proximoEvento(reservas || [], dia);
  const demo = [
    ...sel.avisos, ...reservasDoDia(reservas || [], dia), ...(evento ? [evento] : []),
    ...pendenciasAbertas(pendencias || [], agoraMs), ...(ocorrencias || [])
  ].some((x) => x.demo);
  return {
    geradoEm: agora.toISOString(),
    dia,
    turno,
    config: { paginaSegundos: config?.paginaSegundos ?? 25, turnos: turnos || [] },
    secoes,
    avisos: sel.avisos.map((a) => ({ id: a.id, titulo: a.titulo, mensagem: a.mensagem, prioridade: a.prioridade, fixado: !!a.fixado, fim: a.fim || null })),
    avisosExcedente: sel.excedente,
    reservas: reservasDoDia(reservas || [], dia).map((r) => ({ id: r.id, hora: r.hora, nome: r.nome, pessoas: r.pessoas ?? null, mesa: r.mesa || '', setor: r.setor || '', obs: r.obs || '', status: r.status })),
    evento: evento ? { id: evento.id, data: evento.data, hora: evento.hora, nome: evento.nome, obs: evento.obs || '' } : null,
    pendencias: pendenciasAbertas(pendencias || [], agoraMs).map((p) => ({ id: p.id, acao: p.acao, setor: p.setor, responsavel: p.responsavel, prazo: p.prazo || null, prioridade: p.prioridade, status: p.status, atrasada: p.atrasada, critica: p.critica })),
    rotinas: rotinasParaTv(ocorrencias || [], agora, turno).map((o) => ({ id: o.id, nome: o.nome, setor: o.setor, responsavel: o.responsavel, etapa: o.etapa, hora: o.hora, status: o.status })),
    demo
  };
}

export { localSP };
