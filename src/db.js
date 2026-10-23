import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const TURNOS_PADRAO = [
  { nome: 'da manhã', inicio: '06:00', fim: '11:00' },
  { nome: 'do almoço', inicio: '11:00', fim: '17:00' },
  { nome: 'da noite', inicio: '17:00', fim: '02:00' },
  { nome: 'de fechamento', inicio: '02:00', fim: '06:00' }
];
export const CONFIG_PADRAO = { paginaSegundos: 25, turnos: TURNOS_PADRAO };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usuarios (nome TEXT PRIMARY KEY, hash TEXT NOT NULL, criadoEm TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS avisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL, mensagem TEXT NOT NULL,
  prioridade TEXT NOT NULL DEFAULT 'info' CHECK (prioridade IN ('info','atencao','urgente')),
  inicio TEXT, fim TEXT, fixado INTEGER NOT NULL DEFAULT 0,
  arquivado INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0,
  autor TEXT NOT NULL, criadoEm TEXT NOT NULL, atualizadoEm TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reservas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'reserva' CHECK (tipo IN ('reserva','evento')),
  data TEXT NOT NULL, hora TEXT NOT NULL, nome TEXT NOT NULL, pessoas INTEGER,
  mesa TEXT, setor TEXT, obs TEXT,
  status TEXT NOT NULL DEFAULT 'confirmada' CHECK (status IN ('confirmada','chegou','concluida','cancelada')),
  contato TEXT, notasPrivadas TEXT,
  arquivado INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0,
  autor TEXT NOT NULL, criadoEm TEXT NOT NULL, atualizadoEm TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reservas_data ON reservas (data);
CREATE TABLE IF NOT EXISTS pendencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  acao TEXT NOT NULL, setor TEXT NOT NULL, responsavel TEXT NOT NULL, prazo TEXT,
  prioridade TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta','media','baixa')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','andamento','impedimento','concluida')),
  concluidoEm TEXT,
  arquivado INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0,
  autor TEXT NOT NULL, criadoEm TEXT NOT NULL, atualizadoEm TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rotinas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL, setor TEXT NOT NULL, responsavel TEXT NOT NULL,
  etapa TEXT NOT NULL DEFAULT 'operacao' CHECK (etapa IN ('abertura','operacao','fechamento')),
  dias TEXT NOT NULL, hora TEXT NOT NULL,
  arquivado INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0,
  autor TEXT NOT NULL, criadoEm TEXT NOT NULL, atualizadoEm TEXT NOT NULL
);
-- Cada dia tem o seu próprio registro: concluir hoje nunca conclui amanhã.
CREATE TABLE IF NOT EXISTS ocorrencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rotinaId INTEGER NOT NULL REFERENCES rotinas(id) ON DELETE CASCADE,
  dia TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','concluida')),
  concluidoPor TEXT, concluidoEm TEXT,
  UNIQUE (rotinaId, dia)
);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_dia ON ocorrencias (dia);
CREATE TABLE IF NOT EXISTS historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade TEXT NOT NULL, entidadeId INTEGER NOT NULL, acao TEXT NOT NULL,
  resumo TEXT NOT NULL, autor TEXT NOT NULL, em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_historico_ent ON historico (entidade, entidadeId);
`;

export function abrirBanco(caminho = process.env.DB_PATH || 'data/beco105.db') {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function lerMeta(db, chave) {
  return db.prepare('SELECT valor FROM meta WHERE chave = ?').get(chave)?.valor ?? null;
}
export function gravarMeta(db, chave, valor) {
  db.prepare('INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);
}

export function lerConfig(db) {
  try {
    const salvo = JSON.parse(lerMeta(db, 'config') || '{}');
    return { ...CONFIG_PADRAO, ...salvo };
  } catch { return { ...CONFIG_PADRAO }; }
}
export function gravarConfig(db, cfg) { gravarMeta(db, 'config', JSON.stringify(cfg)); }

/** Segredo de sessão persistido: sobrevive a reinícios e não fica no código. */
export function segredoSessao(db) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = lerMeta(db, 'segredoSessao');
  if (!s) { s = randomBytes(32).toString('hex'); gravarMeta(db, 'segredoSessao', s); }
  return s;
}
