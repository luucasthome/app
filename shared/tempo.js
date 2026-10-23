// Utilitários de data/hora no fuso America/Sao_Paulo.
// Usado pelo servidor, pela TV e pela gestão (módulo ES compartilhado).

export const TZ = 'America/Sao_Paulo';
// O "dia operacional" vira às 05:00: o turno da noite que passa da meia-noite
// continua pertencendo ao dia em que começou.
export const CORTE_DIA_HORA = 5;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
});
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export const DIAS_SEMANA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const DIAS_SEMANA_LONGO = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const pad = (n) => String(n).padStart(2, '0');

export function partesSP(date) {
  const o = {};
  for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
  return { ano: +o.year, mes: +o.month, dia: +o.day, hora: +o.hour % 24, min: +o.minute, seg: +o.second, dow: DOW[o.weekday] };
}

export function dataSP(date) {
  const p = partesSP(date);
  return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`;
}

export function horaSP(date) {
  const p = partesSP(date);
  return `${pad(p.hora)}:${pad(p.min)}`;
}

/** 'YYYY-MM-DDTHH:MM' no fuso de São Paulo. */
export function localSP(date) {
  return `${dataSP(date)}T${horaSP(date)}`;
}

export function somarDias(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function diaSemanaDe(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function diferencaDias(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(a) - t(b)) / 86400000);
}

/** Dia operacional (YYYY-MM-DD) de um instante. Antes das 05:00 ainda é o dia anterior. */
export function diaOperacional(date) {
  const p = partesSP(date);
  const ymd = `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`;
  return p.hora < CORTE_DIA_HORA ? somarDias(ymd, -1) : ymd;
}

/** Converte 'YYYY-MM-DDTHH:MM' (horário de São Paulo) em epoch ms. NaN se inválido. */
export function spParaEpoch(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s || '');
  if (!m) return NaN;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = partesSP(new Date(t));
    t += want - Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min);
  }
  return t;
}

/** Minutos desde o corte do dia operacional: 00:30 vem depois de 23:00. */
export function minutosOp(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h < CORTE_DIA_HORA ? h + 24 : h) * 60 + m;
}

const minutosRelogio = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** O horário HH:MM está dentro do turno {inicio, fim}? (turnos podem passar da meia-noite) */
export function horaNoTurno(hhmm, turno) {
  const x = minutosRelogio(hhmm), a = minutosRelogio(turno.inicio), b = minutosRelogio(turno.fim);
  return a <= b ? x >= a && x < b : x >= a || x < b;
}

export function turnoAtual(turnos, date) {
  const h = horaSP(date);
  return (turnos || []).find((t) => horaNoTurno(h, t)) || null;
}

export function formatarDataLonga(date) {
  const p = partesSP(date);
  return `${DIAS_SEMANA_LONGO[p.dow]}, ${p.dia} de ${MESES[p.mes - 1]}`;
}

/** Rótulo curto do prazo relativo ao dia operacional atual: "17:00", "ontem 18:00", "sáb 10:00"... */
export function rotuloPrazo(prazo, date) {
  const ms = spParaEpoch(prazo);
  if (Number.isNaN(ms)) return '';
  const hora = prazo.slice(11, 16);
  const diaPrazo = diaOperacional(new Date(ms));
  const diff = diferencaDias(diaPrazo, diaOperacional(date));
  if (diff === 0) return hora;
  if (diff === -1) return `ontem ${hora}`;
  if (diff === 1) return `amanhã ${hora}`;
  if (diff > 1 && diff < 7) return `${DIAS_SEMANA_CURTO[diaSemanaDe(diaPrazo)]} ${hora}`;
  return `${diaPrazo.slice(8, 10)}/${diaPrazo.slice(5, 7)} ${hora}`;
}

export function rotuloDia(ymd, hoje) {
  const diff = diferencaDias(ymd, hoje);
  const base = `${DIAS_SEMANA_CURTO[diaSemanaDe(ymd)]} ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
  if (diff === 0) return `Hoje · ${base}`;
  if (diff === 1) return `Amanhã · ${base}`;
  if (diff === -1) return `Ontem · ${base}`;
  return base;
}
