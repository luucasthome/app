import { ENTIDADES, validar, tituloDe } from './entidades.js';
import { lerConfig, gravarConfig } from './db.js';
import { conferirSenha, criarToken, lerToken, lerCookies } from './auth.js';
import { montarTv, pendenciaAtrasada } from '../shared/regras.js';
import { diaOperacional, somarDias, diaSemanaDe, localSP, spParaEpoch, horaSP } from '../shared/tempo.js';

class ErroHttp extends Error {
  constructor(status, mensagem, extra = {}) { super(mensagem); this.status = status; this.extra = extra; }
}
const naoAchou = () => new ErroHttp(404, 'Não encontrado.');

export function criarApi({ db, segredo, agora = () => new Date() }) {
  const tentativas = new Map(); // ip -> [timestamps] (limite simples contra força bruta)

  // ---------- consultas ----------
  const linha = (ent, id) => db.prepare(`SELECT * FROM ${ent} WHERE id = ?`).get(id);
  const exigir = (ent, id) => { const l = linha(ent, Number(id)); if (!l) throw naoAchou(); return l; };

  function registrar(ent, id, acao, resumo, autor) {
    db.prepare('INSERT INTO historico (entidade, entidadeId, acao, resumo, autor, em) VALUES (?,?,?,?,?,?)')
      .run(ent, id, acao, resumo, autor, agora().toISOString());
  }

  function garantirOcorrencias(dia) {
    const dow = diaSemanaDe(dia);
    const rotinas = db.prepare('SELECT id, dias FROM rotinas WHERE arquivado = 0').all();
    const ins = db.prepare('INSERT OR IGNORE INTO ocorrencias (rotinaId, dia) VALUES (?, ?)');
    for (const r of rotinas) if (r.dias.split(',').map(Number).includes(dow)) ins.run(r.id, dia);
  }

  const ocorrenciasDoDia = (dia) => db.prepare(`
    SELECT o.id, o.rotinaId, o.dia, o.status, o.concluidoPor, o.concluidoEm,
           r.nome, r.setor, r.responsavel, r.etapa, r.hora, r.demo
    FROM ocorrencias o JOIN rotinas r ON r.id = o.rotinaId
    WHERE o.dia = ? AND r.arquivado = 0`).all(dia);

  function dadosTv(a) {
    const cfg = lerConfig(db);
    const dia = diaOperacional(a);
    const status = {};
    const tentar = (secao, fn) => { try { return fn(); } catch (e) { console.error(`[tv] seção ${secao} falhou:`, e.message); status[secao] = 'erro'; return []; } };
    const avisos = tentar('avisos', () => db.prepare('SELECT * FROM avisos WHERE arquivado = 0').all());
    const reservas = tentar('reservas', () => db.prepare('SELECT * FROM reservas WHERE arquivado = 0 AND data >= ?').all(dia));
    const pendencias = tentar('pendencias', () => db.prepare("SELECT * FROM pendencias WHERE arquivado = 0 AND status != 'concluida'").all());
    const ocorrencias = tentar('rotinas', () => { garantirOcorrencias(dia); return ocorrenciasDoDia(dia); });
    return montarTv({ avisos, reservas, pendencias, ocorrencias, turnos: cfg.turnos, config: cfg }, a, status);
  }

  // ---------- escrita genérica ----------
  function criar(ent, corpo, autor) {
    const { valores, erros } = validar(ent, corpo);
    if (Object.keys(erros).length) throw new ErroHttp(400, 'Confira os campos.', { campos: erros });
    const agoraIso = agora().toISOString();
    const cols = [...Object.keys(valores), 'autor', 'criadoEm', 'atualizadoEm'];
    const vals = [...Object.values(valores), autor, agoraIso, agoraIso];
    const r = db.prepare(`INSERT INTO ${ent} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    const id = Number(r.lastInsertRowid);
    registrar(ent, id, 'criou', `Criou ${ENTIDADES[ent].rotulo}: ${tituloDe(ent, valores)}`, autor);
    if (ent === 'rotinas') garantirOcorrencias(diaOperacional(agora()));
    return linha(ent, id);
  }

  function resumirMudancas(ent, antes, valores) {
    const def = ENTIDADES[ent].campos;
    const partes = [];
    for (const [k, v] of Object.entries(valores)) {
      if ((antes[k] ?? null) === (v ?? null)) continue;
      if (def[k].privado) { partes.push(`${def[k].nome.toLowerCase()} alterado`); continue; }
      if (def[k].t === 'enum' || k === 'prazo' || k === 'hora' || k === 'data') partes.push(`${def[k].nome.toLowerCase()}: ${antes[k] ?? 'vazio'} → ${v ?? 'vazio'}`);
      else partes.push(`${def[k].nome.toLowerCase()} alterado`);
    }
    return partes.join('; ');
  }

  function gravar(ent, id, mudancas, autor, acao, resumoFixo) {
    const antes = exigir(ent, id);
    const chaves = Object.keys(mudancas);
    if (!chaves.length && !resumoFixo) return antes;
    const agoraIso = agora().toISOString();
    const set = [...chaves.map((c) => `${c} = ?`), 'autor = ?', 'atualizadoEm = ?'];
    db.prepare(`UPDATE ${ent} SET ${set.join(', ')} WHERE id = ?`).run(...chaves.map((c) => mudancas[c]), autor, agoraIso, antes.id);
    registrar(ent, antes.id, acao, resumoFixo || resumirMudancas(ent, antes, mudancas) || 'Salvou sem mudanças', autor);
    return linha(ent, antes.id);
  }

  function atualizar(ent, id, corpo, autor) {
    const antes = exigir(ent, id);
    const { valores, erros } = validar(ent, corpo, true);
    // valida combinações com o que já existe (ex.: fim depois do início)
    if (ent === 'avisos') {
      const ini = 'inicio' in valores ? valores.inicio : antes.inicio, fim = 'fim' in valores ? valores.fim : antes.fim;
      if (ini && fim && fim <= ini) erros.fim = 'O fim precisa ser depois do início.';
    }
    if (Object.keys(erros).length) throw new ErroHttp(400, 'Confira os campos.', { campos: erros });
    if (ent === 'pendencias' && 'status' in valores) {
      valores.concluidoEm = valores.status === 'concluida' ? (antes.concluidoEm || agora().toISOString()) : null;
    }
    const mudou = {};
    for (const [k, v] of Object.entries(valores)) if ((antes[k] ?? null) !== (v ?? null)) mudou[k] = v;
    const r = gravar(ent, id, mudou, autor, 'alterou');
    if (ent === 'rotinas') limparOcorrenciasFuturas(r.id);
    return r;
  }

  // Ao mudar dias/arquivar, ocorrências pendentes de hoje em diante que deixaram de valer saem.
  function limparOcorrenciasFuturas(rotinaId) {
    const r = linha('rotinas', rotinaId);
    const hoje = diaOperacional(agora());
    const dias = r.dias.split(',').map(Number);
    const pend = db.prepare("SELECT id, dia FROM ocorrencias WHERE rotinaId = ? AND dia >= ? AND status = 'pendente'").all(rotinaId, hoje);
    for (const o of pend) if (r.arquivado || !dias.includes(diaSemanaDe(o.dia))) db.prepare('DELETE FROM ocorrencias WHERE id = ?').run(o.id);
    garantirOcorrencias(hoje);
  }

  function duplicar(ent, id, autor) {
    const o = exigir(ent, id);
    const copia = {};
    for (const campo of Object.keys(ENTIDADES[ent].campos)) copia[campo] = o[campo];
    if (ent === 'reservas') copia.status = 'confirmada';
    if (ent === 'pendencias') copia.status = 'pendente';
    if (ent === 'avisos') { copia.fim = null; copia.inicio = null; }
    const nova = criar(ent, copia, autor);
    registrar(ent, nova.id, 'duplicou', `Duplicou ${ENTIDADES[ent].rotulo} #${o.id}`, autor);
    return nova;
  }

  function concluir(ent, id, corpo, autor) {
    const o = exigir(ent, id);
    if (ent === 'avisos') return gravar(ent, o.id, { fim: localSP(agora()) }, autor, 'concluiu', 'Encerrou o aviso agora');
    if (ent === 'reservas') return gravar(ent, o.id, { status: 'concluida' }, autor, 'concluiu', 'Marcou como concluída');
    if (ent === 'pendencias') return gravar(ent, o.id, { status: 'concluida', concluidoEm: agora().toISOString() }, autor, 'concluiu', 'Concluiu a pendência');
    // rotinas: conclui só a ocorrência do dia informado (padrão: hoje)
    const dia = corpo?.dia || diaOperacional(agora());
    garantirOcorrencias(dia);
    const oc = db.prepare('SELECT * FROM ocorrencias WHERE rotinaId = ? AND dia = ?').get(o.id, dia);
    if (!oc) throw new ErroHttp(400, 'Esta rotina não acontece neste dia.');
    db.prepare("UPDATE ocorrencias SET status='concluida', concluidoPor=?, concluidoEm=? WHERE id=?").run(autor, agora().toISOString(), oc.id);
    registrar(ent, o.id, 'concluiu', `Concluiu a ocorrência de ${dia}`, autor);
    return detalheRotina(o.id);
  }

  function reabrir(ent, id, corpo, autor) {
    const o = exigir(ent, id);
    if (ent === 'reservas') return gravar(ent, o.id, { status: 'confirmada' }, autor, 'reabriu', 'Reabriu a reserva');
    if (ent === 'pendencias') return gravar(ent, o.id, { status: 'pendente', concluidoEm: null }, autor, 'reabriu', 'Reabriu a pendência');
    if (ent === 'rotinas') {
      const dia = corpo?.dia || diaOperacional(agora());
      db.prepare("UPDATE ocorrencias SET status='pendente', concluidoPor=NULL, concluidoEm=NULL WHERE rotinaId=? AND dia=?").run(o.id, dia);
      registrar(ent, o.id, 'reabriu', `Reabriu a ocorrência de ${dia}`, autor);
      return detalheRotina(o.id);
    }
    throw new ErroHttp(400, 'Este tipo não pode ser reaberto.');
  }

  function arquivar(ent, id, valor, autor) {
    const o = exigir(ent, id);
    const r = gravar(ent, o.id, { arquivado: valor ? 1 : 0 }, autor, valor ? 'arquivou' : 'desarquivou', valor ? 'Arquivou' : 'Tirou do arquivo');
    if (ent === 'rotinas') limparOcorrenciasFuturas(o.id);
    return r;
  }

  function detalheRotina(id) {
    const r = exigir('rotinas', id);
    const hoje = diaOperacional(agora());
    const dias = [somarDias(hoje, -1), hoje, somarDias(hoje, 1)];
    garantirOcorrencias(hoje); garantirOcorrencias(dias[2]);
    const oc = dias.map((dia) => db.prepare('SELECT * FROM ocorrencias WHERE rotinaId = ? AND dia = ?').get(r.id, dia) || { rotinaId: r.id, dia, status: null });
    return { ...r, ocorrencias: oc };
  }

  // ---------- listagens ----------
  function listar(ent, q) {
    const estado = q.get('estado') || 'ativos';
    const a = agora();
    const dia = diaOperacional(a);
    if (ent === 'avisos') {
      const todos = db.prepare('SELECT * FROM avisos ORDER BY atualizadoEm DESC').all();
      const agoraMs = a.getTime();
      const vencido = (x) => x.fim && spParaEpoch(x.fim) <= agoraMs;
      if (estado === 'arquivados') return todos.filter((x) => x.arquivado);
      if (estado === 'concluidos') return todos.filter((x) => !x.arquivado && vencido(x));
      return todos.filter((x) => !x.arquivado && !vencido(x));
    }
    if (ent === 'reservas') {
      const de = q.get('de') || dia, ate = q.get('ate') || somarDias(de, 365);
      const todos = db.prepare('SELECT * FROM reservas WHERE data >= ? AND data <= ? ORDER BY data, hora').all(de, ate);
      if (estado === 'arquivados') return db.prepare('SELECT * FROM reservas WHERE arquivado = 1 ORDER BY data DESC, hora').all();
      const vivas = todos.filter((x) => !x.arquivado);
      if (estado === 'periodo') return vivas;
      if (estado === 'concluidos') return vivas.filter((x) => x.status === 'concluida' || x.status === 'cancelada');
      return vivas.filter((x) => x.status === 'confirmada' || x.status === 'chegou');
    }
    if (ent === 'pendencias') {
      const todos = db.prepare('SELECT * FROM pendencias ORDER BY atualizadoEm DESC').all();
      const agoraMs = a.getTime();
      if (estado === 'arquivados') return todos.filter((x) => x.arquivado);
      if (estado === 'concluidos') return todos.filter((x) => !x.arquivado && x.status === 'concluida');
      return todos.filter((x) => !x.arquivado && x.status !== 'concluida').map((x) => ({ ...x, atrasada: pendenciaAtrasada(x, agoraMs) }));
    }
    // rotinas: definições com a ocorrência de hoje
    garantirOcorrencias(dia);
    const todos = db.prepare('SELECT * FROM rotinas ORDER BY hora, nome').all();
    if (estado === 'arquivados') return todos.filter((x) => x.arquivado);
    const hoje = new Map(ocorrenciasDoDia(dia).map((o) => [o.rotinaId, o]));
    return todos.filter((x) => !x.arquivado).map((x) => ({ ...x, hoje: hoje.get(x.id) || null }));
  }

  function resumo() {
    const a = agora();
    const dia = diaOperacional(a);
    const agoraMs = a.getTime();
    garantirOcorrencias(dia);
    const avisos = listar('avisos', new URLSearchParams());
    const reservas = db.prepare("SELECT * FROM reservas WHERE arquivado=0 AND data=? AND tipo='reserva' AND status IN ('confirmada','chegou')").all(dia);
    const pend = db.prepare("SELECT * FROM pendencias WHERE arquivado=0 AND status != 'concluida'").all();
    const atrasadas = pend.filter((p) => pendenciaAtrasada(p, agoraMs));
    const oc = ocorrenciasDoDia(dia);
    const venceLogo = avisos.filter((x) => x.fim && spParaEpoch(x.fim) - agoraMs < 2 * 3600e3);
    return {
      dia,
      avisos: { ativos: avisos.length },
      reservas: { hoje: reservas.length, pessoas: reservas.reduce((s, r) => s + (r.pessoas || 0), 0) },
      pendencias: { abertas: pend.length, atrasadas: atrasadas.length },
      rotinas: { total: oc.length, feitas: oc.filter((o) => o.status === 'concluida').length },
      atencao: [
        ...atrasadas.map((p) => ({ tipo: 'pendencias', id: p.id, rotulo: 'ATRASADA', texto: p.acao })),
        ...venceLogo.map((x) => ({ tipo: 'avisos', id: x.id, rotulo: `AVISO VENCE ${x.fim.slice(11, 16)}`, texto: x.titulo }))
      ].slice(0, 6)
    };
  }

  function concluidosRecentes() {
    const itens = [];
    const add = (tipo, rows, quando, titulo, extra) => rows.forEach((r) => itens.push({ tipo, id: r.id, titulo: titulo(r), em: quando(r), ...(extra ? extra(r) : {}) }));
    add('pendencias', db.prepare("SELECT * FROM pendencias WHERE status='concluida' AND arquivado=0 ORDER BY concluidoEm DESC LIMIT 30").all(), (r) => r.concluidoEm || r.atualizadoEm, (r) => r.acao);
    add('reservas', db.prepare("SELECT * FROM reservas WHERE status IN ('concluida','cancelada') AND arquivado=0 ORDER BY atualizadoEm DESC LIMIT 30").all(), (r) => r.atualizadoEm, (r) => `${r.nome} · ${r.data.slice(8)}/${r.data.slice(5, 7)} ${r.hora}`, (r) => ({ estado: r.status }));
    add('avisos', db.prepare("SELECT * FROM avisos WHERE fim IS NOT NULL AND arquivado=0 ORDER BY fim DESC LIMIT 60").all().filter((r) => spParaEpoch(r.fim) <= agora().getTime()).slice(0, 30), (r) => r.atualizadoEm, (r) => r.titulo);
    add('rotinas', db.prepare("SELECT o.id, o.concluidoEm, o.dia, r.nome, r.id AS rid FROM ocorrencias o JOIN rotinas r ON r.id=o.rotinaId WHERE o.status='concluida' ORDER BY o.concluidoEm DESC LIMIT 30").all(), (r) => r.concluidoEm, (r) => `${r.nome} · ${r.dia.slice(8)}/${r.dia.slice(5, 7)}`, (r) => ({ id: r.rid }));
    return itens.sort((a, b) => String(b.em).localeCompare(String(a.em))).slice(0, 60);
  }

  // ---------- roteamento ----------
  async function lerCorpo(req) {
    const tipo = String(req.headers['content-type'] || '');
    if (!tipo.includes('application/json')) throw new ErroHttp(415, 'Envie JSON.');
    let tam = 0; const partes = [];
    for await (const p of req) { tam += p.length; if (tam > 64 * 1024) throw new ErroHttp(413, 'Corpo grande demais.'); partes.push(p); }
    if (!partes.length) return {};
    try { return JSON.parse(Buffer.concat(partes).toString()); } catch { throw new ErroHttp(400, 'JSON inválido.'); }
  }

  function usuarioDe(req) {
    return lerToken(lerCookies(req).beco_sess, segredo, agora().getTime());
  }

  /** Retorna { status, corpo, cookie? } */
  async function tratar(req, url) {
    const metodo = req.method;
    const rota = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const q = url.searchParams;

    // públicas
    if (metodo === 'GET' && rota[0] === 'saude') return { status: 200, corpo: { ok: true } };
    if (metodo === 'GET' && rota[0] === 'tv') return { status: 200, corpo: dadosTv(agora()) };

    if (metodo === 'POST' && rota[0] === 'login') {
      const ip = req.socket.remoteAddress || '?';
      const t = (tentativas.get(ip) || []).filter((x) => x > Date.now() - 60000);
      if (t.length >= 8) throw new ErroHttp(429, 'Muitas tentativas. Espere um minuto.');
      const { usuario, senha } = await lerCorpo(req);
      const u = db.prepare('SELECT * FROM usuarios WHERE nome = ? COLLATE NOCASE').get(String(usuario || '').trim());
      if (!u || !conferirSenha(String(senha || ''), u.hash)) {
        tentativas.set(ip, [...t, Date.now()]);
        throw new ErroHttp(401, 'Usuário ou senha incorretos.');
      }
      return { status: 200, corpo: { usuario: u.nome }, token: criarToken(u.nome, segredo, undefined, agora().getTime()) };
    }
    if (metodo === 'POST' && rota[0] === 'logout') return { status: 200, corpo: { ok: true }, token: '' };

    // protegidas
    const autor = usuarioDe(req);
    if (!autor) throw new ErroHttp(401, 'Entre para continuar.');
    if (metodo === 'GET' && rota[0] === 'eu') return { status: 200, corpo: { usuario: autor } };
    if (metodo === 'GET' && rota[0] === 'resumo') return { status: 200, corpo: resumo() };
    if (metodo === 'GET' && rota[0] === 'concluidos') return { status: 200, corpo: concluidosRecentes() };
    if (rota[0] === 'config') {
      if (metodo === 'GET') return { status: 200, corpo: lerConfig(db) };
      if (metodo === 'PUT') {
        const c = await lerCorpo(req);
        const cfg = lerConfig(db);
        if ('paginaSegundos' in c) {
          const n = Number(c.paginaSegundos);
          if (!Number.isInteger(n) || n < 10 || n > 120) throw new ErroHttp(400, 'Tempo por página: de 10 a 120 segundos.');
          cfg.paginaSegundos = n;
        }
        if (Array.isArray(c.turnos)) {
          const ok = c.turnos.every((t) => t && typeof t.nome === 'string' && /^\d\d:\d\d$/.test(t.inicio) && /^\d\d:\d\d$/.test(t.fim));
          if (!ok) throw new ErroHttp(400, 'Turnos inválidos.');
          cfg.turnos = c.turnos.map((t) => ({ nome: t.nome.slice(0, 30), inicio: t.inicio, fim: t.fim }));
        }
        gravarConfig(db, cfg);
        return { status: 200, corpo: cfg };
      }
    }
    if (metodo === 'GET' && rota[0] === 'historico') {
      const ent = q.get('entidade'), id = Number(q.get('id'));
      const lim = Math.min(Number(q.get('limite')) || 30, 100);
      const rows = ent && id
        ? db.prepare('SELECT * FROM historico WHERE entidade = ? AND entidadeId = ? ORDER BY id DESC LIMIT ?').all(ent, id, lim)
        : db.prepare('SELECT * FROM historico ORDER BY id DESC LIMIT ?').all(lim);
      return { status: 200, corpo: rows };
    }

    const ent = rota[0];
    if (!ENTIDADES[ent]) throw naoAchou();
    const id = rota[1];
    const acao = rota[2];
    if (!id) {
      if (metodo === 'GET') return { status: 200, corpo: listar(ent, q) };
      if (metodo === 'POST') return { status: 201, corpo: criar(ent, await lerCorpo(req), autor) };
    } else if (!acao) {
      if (metodo === 'GET') return { status: 200, corpo: ent === 'rotinas' ? detalheRotina(Number(id)) : exigir(ent, Number(id)) };
      if (metodo === 'PUT') {
        const r = atualizar(ent, id, await lerCorpo(req), autor);
        return { status: 200, corpo: ent === 'rotinas' ? detalheRotina(r.id) : r };
      }
    } else if (metodo === 'POST') {
      const corpo = ['concluir', 'reabrir'].includes(acao) ? await lerCorpo(req) : {};
      if (acao === 'duplicar') return { status: 201, corpo: duplicar(ent, id, autor) };
      if (acao === 'concluir') return { status: 200, corpo: concluir(ent, id, corpo, autor) };
      if (acao === 'reabrir') return { status: 200, corpo: reabrir(ent, id, corpo, autor) };
      if (acao === 'arquivar') return { status: 200, corpo: arquivar(ent, id, true, autor) };
      if (acao === 'desarquivar') return { status: 200, corpo: arquivar(ent, id, false, autor) };
    }
    throw new ErroHttp(405, 'Operação não suportada.');
  }

  async function handler(req, res, url) {
    try {
      const r = await tratar(req, url);
      const cab = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
      if (r.token !== undefined) {
        const seguro = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
        cab['Set-Cookie'] = r.token
          ? `beco_sess=${encodeURIComponent(r.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${seguro}`
          : `beco_sess=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${seguro}`;
      }
      res.writeHead(r.status, cab);
      res.end(JSON.stringify(r.corpo));
    } catch (e) {
      const status = e instanceof ErroHttp ? e.status : 500;
      if (status === 500) console.error('[api]', e);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ erro: status === 500 ? 'Erro interno.' : e.message, ...(e.extra || {}) }));
    }
  }

  return { handler, dadosTv, garantirOcorrencias };
}
