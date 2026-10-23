// Paginação por altura medida: nenhum texto é cortado nem reduzido.
// Itens críticos ficam fixos no topo de todas as páginas; o resto se distribui.

/**
 * @param {{h:number, critico?:boolean}[]} itens alturas medidas (px) na ordem de prioridade
 * @param {number} alturaDisp altura disponível para a lista (px)
 * @param {number} gap espaço entre itens (px)
 * @returns {number[][]} índices dos itens por página (sempre pelo menos 1 página)
 */
export function paginarPorAltura(itens, alturaDisp, gap = 0) {
  if (!itens.length) return [[]];
  const altura = (idx) => idx.reduce((s, i) => s + itens[i].h, 0) + gap * Math.max(0, idx.length - 1);

  // Fixa os críticos enquanto ocupam no máximo 50% da área (sempre sobra espaço para itens comuns).
  const fixos = [];
  for (let i = 0; i < itens.length; i++) {
    if (!itens[i].critico) continue;
    if (altura([...fixos, i]) <= alturaDisp * 0.5) fixos.push(i);
  }
  const resto = itens.map((_, i) => i).filter((i) => !fixos.includes(i));
  if (!resto.length) return [fixos.length ? fixos : [0]];

  const paginas = [];
  let atual = [];
  const base = fixos.length ? altura(fixos) + gap : 0;
  let usado = base;
  for (const i of resto) {
    const extra = itens[i].h + (atual.length ? gap : 0);
    if (atual.length && usado + extra > alturaDisp) {
      paginas.push(atual);
      atual = [];
      usado = base;
    }
    usado += itens[i].h + (atual.length ? gap : 0);
    atual.push(i);
  }
  if (atual.length) paginas.push(atual);
  return paginas.map((p) => [...fixos, ...p].sort((a, b) => a - b));
}

/** Coluna com menos páginas que o total volta ao início (módulo). */
export const paginaDaColuna = (paginas, indiceGlobal) => paginas[indiceGlobal % paginas.length];
