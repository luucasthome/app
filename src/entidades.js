// Definição dos quatro tipos de conteúdo e validação dos campos.
export const SETORES = ['Bar', 'Cozinha', 'Salão', 'Gerência'];

export const ENTIDADES = {
  avisos: {
    rotulo: 'aviso', titulo: 'titulo',
    campos: {
      titulo: { t: 's', req: true, max: 40, nome: 'Título' },
      mensagem: { t: 's', req: true, max: 100, nome: 'Mensagem' },
      prioridade: { t: 'enum', valores: ['info', 'atencao', 'urgente'], padrao: 'info', nome: 'Prioridade' },
      inicio: { t: 'dt', nome: 'Início' },
      fim: { t: 'dt', nome: 'Fim' },
      fixado: { t: 'b', padrao: 0, nome: 'Fixar na TV' }
    }
  },
  reservas: {
    rotulo: 'reserva', titulo: 'nome',
    campos: {
      tipo: { t: 'enum', valores: ['reserva', 'evento'], padrao: 'reserva', nome: 'Tipo' },
      data: { t: 'data', req: true, nome: 'Data' },
      hora: { t: 'hora', req: true, nome: 'Horário' },
      nome: { t: 's', req: true, max: 30, nome: 'Nome' },
      pessoas: { t: 'n', min: 1, max: 999, nome: 'Pessoas' },
      mesa: { t: 's', max: 20, nome: 'Mesa' },
      setor: { t: 's', max: 20, nome: 'Setor' },
      obs: { t: 's', max: 50, nome: 'Observação' },
      status: { t: 'enum', valores: ['confirmada', 'chegou', 'concluida', 'cancelada'], padrao: 'confirmada', nome: 'Status' },
      contato: { t: 's', max: 80, privado: true, nome: 'Contato' },
      notasPrivadas: { t: 's', max: 200, privado: true, nome: 'Notas privadas' }
    }
  },
  pendencias: {
    rotulo: 'pendência', titulo: 'acao',
    campos: {
      acao: { t: 's', req: true, max: 60, nome: 'Ação' },
      setor: { t: 'enum', valores: SETORES, req: true, nome: 'Setor' },
      responsavel: { t: 's', req: true, max: 30, nome: 'Responsável' },
      prazo: { t: 'dt', nome: 'Prazo' },
      prioridade: { t: 'enum', valores: ['alta', 'media', 'baixa'], padrao: 'media', nome: 'Prioridade' },
      status: { t: 'enum', valores: ['pendente', 'andamento', 'impedimento', 'concluida'], padrao: 'pendente', nome: 'Status' }
    }
  },
  rotinas: {
    rotulo: 'rotina', titulo: 'nome',
    campos: {
      nome: { t: 's', req: true, max: 50, nome: 'Nome da atividade' },
      setor: { t: 'enum', valores: SETORES, req: true, nome: 'Setor' },
      responsavel: { t: 's', req: true, max: 30, nome: 'Responsável' },
      etapa: { t: 'enum', valores: ['abertura', 'operacao', 'fechamento'], padrao: 'operacao', nome: 'Etapa' },
      dias: { t: 'dias', req: true, nome: 'Dias' },
      hora: { t: 'hora', req: true, nome: 'Horário' }
    }
  }
};

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_DT = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

function dataValida(s) {
  if (!RE_DATA.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * Valida e normaliza. `parcial` = atualização: só os campos enviados são tratados.
 * Retorna { valores, erros }. Campos opcionais vazios viram null (nunca 0 nem texto inventado).
 */
export function validar(ent, corpo, parcial = false) {
  const def = ENTIDADES[ent];
  const valores = {}, erros = {};
  for (const [campo, c] of Object.entries(def.campos)) {
    const enviado = Object.prototype.hasOwnProperty.call(corpo, campo);
    if (parcial && !enviado) continue;
    let v = corpo[campo];
    const vazio = v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);
    if (vazio) {
      if (c.req) { erros[campo] = `${c.nome} é obrigatório.`; continue; }
      valores[campo] = c.t === 'b' ? 0 : (c.padrao !== undefined && !parcial ? c.padrao : (c.padrao !== undefined && enviado && c.t === 'enum' ? c.padrao : null));
      continue;
    }
    switch (c.t) {
      case 's':
        v = String(v).replace(/\s+/g, ' ').trim();
        if (v.length > c.max) erros[campo] = `${c.nome}: no máximo ${c.max} caracteres.`;
        break;
      case 'enum':
        if (!c.valores.includes(v)) erros[campo] = `${c.nome}: valor inválido.`;
        break;
      case 'b': v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0; break;
      case 'n':
        v = Number(v);
        if (!Number.isInteger(v) || v < c.min || v > c.max) erros[campo] = `${c.nome}: informe um número entre ${c.min} e ${c.max}.`;
        break;
      case 'data': if (!dataValida(String(v))) erros[campo] = `${c.nome}: data inválida.`; break;
      case 'hora': if (!RE_HORA.test(String(v))) erros[campo] = `${c.nome}: use HH:MM.`; break;
      case 'dt':
        v = String(v).replace(' ', 'T').slice(0, 16);
        if (!RE_DT.test(v) || !dataValida(v.slice(0, 10))) erros[campo] = `${c.nome}: data e hora inválidas.`;
        break;
      case 'dias': {
        const arr = Array.isArray(v) ? v.map(Number) : String(v).split(',').map(Number);
        if (!arr.length || arr.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) erros[campo] = `${c.nome}: escolha ao menos um dia.`;
        else v = [...new Set(arr)].sort().join(',');
        break;
      }
    }
    valores[campo] = v;
  }
  if (ent === 'avisos' && valores.inicio && valores.fim && valores.fim <= valores.inicio) erros.fim = 'O fim precisa ser depois do início.';
  return { valores, erros };
}

export const tituloDe = (ent, linha) => linha?.[ENTIDADES[ent].titulo] ?? '';
