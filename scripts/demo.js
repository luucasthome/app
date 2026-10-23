// npm run demo         -> insere dados de demonstração (marcados como demo=1)
// npm run demo:limpar  -> remove somente o que foi inserido por este script
import { abrirBanco } from '../src/db.js';
import { hashSenha } from '../src/auth.js';
import { diaOperacional, somarDias, localSP } from '../shared/tempo.js';

const db = abrirBanco();
const TABELAS = ['avisos', 'reservas', 'pendencias', 'rotinas'];

if (process.argv[2] === 'limpar') {
  for (const t of TABELAS) db.prepare(`DELETE FROM ${t} WHERE demo = 1`).run(); // ocorrências saem em cascata
  console.log('Dados de demonstração removidos.');
  process.exit(0);
}

const agora = new Date();
const hoje = diaOperacional(agora);
const amanha = somarDias(hoje, 1);
const iso = agora.toISOString();
const autor = 'Demonstração';
const mais = (h) => localSP(new Date(agora.getTime() + h * 3600e3));

const ins = (tabela, o) => {
  const cols = [...Object.keys(o), 'demo', 'autor', 'criadoEm', 'atualizadoEm'];
  db.prepare(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(o), 1, autor, iso, iso);
};

ins('avisos', { titulo: 'Fogão 2 sem gás', mensagem: 'Usar fogão 1 e chapa até o técnico chegar.', prioridade: 'urgente', fim: mais(6), fixado: 1 });
ins('avisos', { titulo: 'Sexta lotada', mensagem: 'Repor gelo e couvert antes das 20h. Reforço no salão.', prioridade: 'atencao', fim: mais(5), fixado: 0 });
ins('avisos', { titulo: 'Prato do dia', mensagem: 'Costela de 12h. Avisar a mesa que acaba cedo.', prioridade: 'info', fim: mais(8), fixado: 0 });

const reservas = [
  ['19:30', 'Marina', 6, 'Mesa 12', 'Salão', 'Aniversário', 'chegou'],
  ['20:00', 'Ricardo', 2, null, 'Bar', 'Balcão', 'confirmada'],
  ['20:00', 'Grupo Alves', 8, 'Mesa 3', 'Salão', 'Conta única', 'confirmada'],
  ['20:15', 'Beatriz', 4, null, null, null, 'confirmada'],
  ['20:30', 'Paulo', 5, 'Mesa 9', 'Salão', 'Sem glúten', 'confirmada'],
  ['21:00', 'Empresa Delta', 12, 'Mesa longa', 'Salão', 'Jantar fechado', 'confirmada'],
  ['21:15', 'Família Souza', 4, 'Mesa 7', 'Salão', 'Cadeirão', 'confirmada'],
  ['21:30', 'Júlio', 2, null, 'Bar', null, 'confirmada'],
  ['22:00', 'Carla Dias', 3, 'Mesa 5', 'Salão', 'Cardápio vegano', 'confirmada']
];
for (const [hora, nome, pessoas, mesa, setor, obs, status] of reservas) {
  ins('reservas', { tipo: 'reserva', data: hoje, hora, nome, pessoas, mesa, setor, obs, status, contato: '(11) 90000-0000', notasPrivadas: 'Contato fictício de demonstração' });
}
ins('reservas', { tipo: 'evento', data: amanha, hora: '20:00', nome: 'Roda de samba', obs: 'mesas só com reserva', status: 'confirmada' });

const pend = [
  ['Trocar botijão do fogão 2', 'Cozinha', 'Rafael', mais(-3), 'alta', 'andamento'],
  ['Técnico da câmara fria', 'Gerência', 'Lucas', localSP(new Date(agora.getTime() - 26 * 3600e3)), 'alta', 'impedimento'],
  ['Repor gelo e limões', 'Bar', 'Júlia', mais(1), 'media', 'pendente'],
  ['Conferir mesas externas', 'Salão', 'Camila', mais(1.5), 'media', 'pendente'],
  ['Imprimir cardápio novo', 'Gerência', 'Lucas', mais(20), 'baixa', 'pendente'],
  ['Revisar escala de domingo', 'Gerência', 'Lucas', mais(40), 'media', 'andamento'],
  ['Limpar coifa da cozinha', 'Cozinha', 'Rafael', mais(36), 'baixa', 'pendente'],
  ['Pedir guardanapos', 'Salão', 'Camila', mais(60), 'baixa', 'pendente']
];
for (const [acao, setor, responsavel, prazo, prioridade, status] of pend) ins('pendencias', { acao, setor, responsavel, prazo, prioridade, status });

const todos = '0,1,2,3,4,5,6';
const rot = [
  ['Abertura do salão', 'Salão', 'Camila', 'abertura', '17:00'],
  ['Conferir câmara fria', 'Cozinha', 'Rafael', 'operacao', '20:00'],
  ['Ronda dos banheiros', 'Salão', 'Camila', 'operacao', '20:30'],
  ['Reabastecer geladeiras', 'Bar', 'Júlia', 'operacao', '21:00'],
  ['Caixa parcial', 'Gerência', 'Lucas', 'operacao', '22:00'],
  ['Último pedido da cozinha', 'Cozinha', 'Rafael', 'operacao', '23:00'],
  ['Fechar caixa', 'Gerência', 'Lucas', 'fechamento', '00:30'],
  ['Limpar a chapa', 'Cozinha', 'Rafael', 'fechamento', '01:00'],
  ['Lixo e vidros', 'Salão', 'Camila', 'fechamento', '01:30']
];
for (const [nome, setor, responsavel, etapa, hora] of rot) ins('rotinas', { nome, setor, responsavel, etapa, hora, dias: todos });

if (!db.prepare('SELECT 1 FROM usuarios LIMIT 1').get()) {
  db.prepare('INSERT INTO usuarios (nome, hash, criadoEm) VALUES (?,?,?)').run('gerencia', hashSenha('beco105demo'), iso);
  console.log('Usuário de demonstração criado: gerencia / beco105demo  (TROQUE: npm run usuario -- gerencia <nova senha>)');
}
console.log('Dados de demonstração inseridos. Para remover: npm run demo:limpar');
