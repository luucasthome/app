// Conteúdo do projeto demonstrativo. Usado pelo servidor e pela versão HTML única (standalone).

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}


export const DEMO_PROJECT = {
  name: 'Projeto demonstrativo',
  description: 'Exemplo com tarefas fictícias para você conhecer o quadro. Pode editar à vontade e excluir quando quiser, em Configurações.',
  dueOffset: 14,
};

// Tarefas fictícias do projeto demonstrativo. `offset` = dias a partir de hoje (null = sem prazo).
export const DEMO_TASKS = [
  { title: 'Definir objetivos do projeto', description: 'Escreva em poucas linhas o que significa “projeto concluído”.', column: 'todo', priority: 'high', offset: 3,
    checklist: [['Listar resultados esperados', true], ['Definir como medir o sucesso', false], ['Validar com as pessoas envolvidas', false]] },
  { title: 'Levantar referências', description: '', column: 'todo', priority: 'low', offset: null, checklist: [] },
  { title: 'Montar o cronograma', description: 'Dica: arraste este cartão para outra coluna ou abra-o para ver os detalhes.', column: 'doing', priority: 'medium', offset: -2,
    checklist: [['Listar etapas', true], ['Estimar prazos', true], ['Distribuir no calendário', false]] },
  { title: 'Revisar o orçamento', description: '', column: 'review', priority: 'high', offset: 0, checklist: [] },
  { title: 'Reunião de kick-off', description: 'Primeira conversa com todos.', column: 'done', priority: 'medium', offset: -7, checklist: [] },
  { title: 'Criar pasta de arquivos', description: '', column: 'done', priority: 'low', offset: null, checklist: [] },
];
