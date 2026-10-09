// Ajudantes compartilhados pelos testes de navegador.

export const cardTitles = (page, col) => page.locator(`.card-list[data-column="${col}"] .card-title`).allTextContents();

export async function dragCard(page, fromTitle, toColumn, beforeTitle) {
  const card = page.locator('.card', { hasText: fromTitle }).first();
  const cb = await card.boundingBox();
  let tx; let ty;
  if (beforeTitle) {
    const t = await page.locator('.card', { hasText: beforeTitle }).first().boundingBox();
    tx = t.x + t.width / 2; ty = t.y + 4;
  } else {
    const list = await page.locator(`.card-list[data-column="${toColumn}"]`).boundingBox();
    tx = list.x + list.width / 2; ty = list.y + list.height - 6;
  }
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 10, cb.y + cb.height / 2 + 10, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(500);
}
