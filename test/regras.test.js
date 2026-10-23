import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diaOperacional, spParaEpoch, localSP, horaNoTurno, rotuloPrazo, somarDias, minutosOp } from '../shared/tempo.js';
import { avisoAtivo, selecionarAvisos, reservasDoDia, proximoEvento, pendenciasAbertas, rotinasParaTv, montarTv } from '../shared/regras.js';
import { paginarPorAltura, paginaDaColuna } from '../shared/paginacao.js';

const sp = (s) => new Date(spParaEpoch(s)); // horário de São Paulo -> Date

test('fuso: America/Sao_Paulo e dia operacional virando às 05:00', () => {
  assert.equal(localSP(new Date('2026-10-24T02:30:00Z')), '2026-10-23T23:30');
  assert.equal(spParaEpoch('2026-10-23T23:30'), Date.parse('2026-10-24T02:30:00Z'));
  assert.equal(diaOperacional(sp('2026-10-24T01:30')), '2026-10-23');
  assert.equal(diaOperacional(sp('2026-10-24T05:00')), '2026-10-24');
  assert.ok(minutosOp('00:30') > minutosOp('23:00'));
});

test('turno que passa da meia-noite', () => {
  const noite = { nome: 'noite', inicio: '17:00', fim: '02:00' };
  assert.ok(horaNoTurno('23:59', noite)); assert.ok(horaNoTurno('01:59', noite));
  assert.ok(!horaNoTurno('02:00', noite)); assert.ok(!horaNoTurno('16:59', noite));
});

test('avisos vencidos deixam de aparecer; início futuro ainda não aparece', () => {
  const agora = sp('2026-10-23T20:00').getTime();
  const base = { arquivado: 0, prioridade: 'info' };
  assert.ok(avisoAtivo({ ...base, inicio: '2026-10-23T18:00', fim: '2026-10-23T22:00' }, agora));
  assert.ok(!avisoAtivo({ ...base, fim: '2026-10-23T19:59' }, agora), 'vencido');
  assert.ok(!avisoAtivo({ ...base, inicio: '2026-10-23T20:01' }, agora), 'ainda não começou');
  assert.ok(avisoAtivo({ ...base, inicio: null, fim: null }, agora), 'sem datas = sempre');
  assert.ok(!avisoAtivo({ ...base, arquivado: 1 }, agora));
});

test('até 3 avisos: urgentes sempre dentro, depois fixados', () => {
  const agora = Date.now();
  const mk = (id, prioridade, fixado = 0) => ({ id, prioridade, fixado, arquivado: 0, atualizadoEm: `2026-01-0${id}` });
  const r = selecionarAvisos([mk(1, 'info', 1), mk(2, 'atencao'), mk(3, 'info'), mk(4, 'urgente'), mk(5, 'atencao', 1)], agora);
  assert.deepEqual(r.avisos.map((a) => a.id), [4, 5, 1]);
  assert.equal(r.excedente, 2);
});

test('reservas: canceladas e concluídas saem; ordem por horário (00:30 depois de 23:00)', () => {
  const mk = (id, hora, status = 'confirmada', extra = {}) => ({ id, hora, status, nome: `R${id}`, data: '2026-10-23', tipo: 'reserva', arquivado: 0, ...extra });
  const lista = reservasDoDia([mk(1, '00:30'), mk(2, '23:00'), mk(3, '20:00', 'cancelada'), mk(4, '19:00', 'concluida'), mk(5, '21:00', 'chegou'), mk(6, '20:00', 'confirmada', { data: '2026-10-24' })], '2026-10-23');
  assert.deepEqual(lista.map((r) => r.id), [5, 2, 1]);
});

test('próximo evento: primeiro não concluído de hoje em diante', () => {
  const ev = (id, data, hora, status = 'confirmada') => ({ id, data, hora, status, tipo: 'evento', nome: 'E', arquivado: 0 });
  assert.equal(proximoEvento([ev(1, '2026-10-22', '20:00'), ev(2, '2026-10-25', '20:00'), ev(3, '2026-10-24', '20:00', 'cancelada'), ev(4, '2026-10-24', '21:00')], '2026-10-23').id, 4);
  assert.equal(proximoEvento([], '2026-10-23'), null);
});

test('pendências: atrasadas continuam visíveis e vão primeiro; concluídas saem', () => {
  const agora = sp('2026-10-23T20:00').getTime();
  const p = (id, prioridade, prazo, status = 'pendente') => ({ id, prioridade, prazo, status, arquivado: 0 });
  const r = pendenciasAbertas([p(1, 'baixa', '2026-10-23T21:00'), p(2, 'media', '2026-10-22T10:00'), p(3, 'alta', '2026-10-24T10:00'), p(4, 'media', null), p(5, 'alta', '2026-10-23T10:00', 'concluida')], agora);
  assert.deepEqual(r.map((x) => x.id), [2, 3, 4, 1]);
  assert.equal(r[0].atrasada, true); assert.equal(r[1].atrasada, false);
  assert.equal(r.find((x) => x.id === 4).atrasada, false, 'sem prazo nunca é atrasada');
});

test('rotinas na TV: atrasadas e do turno; concluídas ao fim', () => {
  const noite = { inicio: '17:00', fim: '02:00' };
  const agora = sp('2026-10-23T20:10');
  const o = (id, hora, status = 'pendente') => ({ id, hora, status, nome: `O${id}` });
  const r = rotinasParaTv([o(1, '09:00'), o(2, '18:00', 'concluida'), o(3, '20:00'), o(4, '23:00'), o(5, '00:30'), o(6, '10:00', 'concluida')], agora, noite);
  assert.deepEqual(r.map((x) => x.id), [1, 3, 4, 5, 2]); // 09:00 pendente atrasada continua; 10:00 concluída fora do turno some
});

test('TV: nenhum dado privado no payload', () => {
  const agora = sp('2026-10-23T20:00');
  const tv = montarTv({
    avisos: [], pendencias: [], ocorrencias: [], turnos: [], config: {},
    reservas: [{ id: 1, tipo: 'reserva', data: '2026-10-23', hora: '20:30', nome: 'Ana', pessoas: null, mesa: '', setor: '', obs: '', status: 'confirmada', contato: '11 99999-9999', notasPrivadas: 'alérgica', arquivado: 0 }]
  }, agora);
  assert.ok(!JSON.stringify(tv).includes('99999') && !JSON.stringify(tv).includes('alérgica'));
  assert.equal(tv.reservas[0].pessoas, null, 'campo vazio não vira 0');
});

test('rótulo de prazo', () => {
  const agora = sp('2026-10-23T20:00');
  assert.equal(rotuloPrazo('2026-10-23T21:00', agora), '21:00');
  assert.equal(rotuloPrazo('2026-10-22T18:00', agora), 'ontem 18:00');
  assert.equal(rotuloPrazo('2026-10-24T12:00', agora), 'amanhã 12:00');
  assert.equal(rotuloPrazo('2026-10-26T10:00', agora), 'seg 10:00');
});

test('paginação por altura: nada some, nada ultrapassa, críticos fixos', () => {
  const itens = Array.from({ length: 10 }, () => ({ h: 100 }));
  const pags = paginarPorAltura(itens, 330, 8); // cabem 3 por página
  assert.deepEqual(pags.map((p) => p.length), [3, 3, 3, 1]);
  assert.deepEqual(pags.flat().sort((a, b) => a - b), [...Array(10).keys()]);
  // crítico fixo em todas as páginas
  const c = paginarPorAltura([{ h: 100, critico: true }, ...Array.from({ length: 6 }, () => ({ h: 100 }))], 330, 8);
  assert.ok(c.every((p) => p.includes(0)));
  assert.ok(c.every((p) => p.length * 100 + (p.length - 1) * 8 <= 330));
  assert.equal(new Set(c.flat()).size, 7);
  // item maior que a área ainda aparece (uma página só dele)
  assert.deepEqual(paginarPorAltura([{ h: 900 }, { h: 50 }], 300, 8), [[0], [1]]);
  assert.deepEqual(paginarPorAltura([], 300, 8), [[]]);
  assert.deepEqual(paginaDaColuna([[0], [1]], 3), [1]);
});

test('somarDias atravessa mês e ano', () => {
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
});
