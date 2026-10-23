# Mural da Equipe | Beco105

Mural de comunicação interna para a TV (55", horizontal), atualizado pelo celular da gerência.
Sem dependências: só Node.js 22.13+ (usa o SQLite embutido) e arquivos estáticos.

- **TV** (`/tv`): somente leitura, tela cheia, 16:9 (referência 1920×1080; em 4K o mesmo layout é escalado 2×).
- **Gestão** (`/gestao`): com login, pensada para o celular. Quatro acessos: Aviso, Reserva, Pendência, Rotina.
- Os dois lados leem e gravam na mesma base (`data/beco105.db`, SQLite).

## Subir o servidor

```bash
npm run usuario -- lucas "uma-senha-com-8-ou-mais-caracteres"   # cria (ou troca a senha de) um usuário da gerência
npm start                                                       # http://localhost:3000
```

Variáveis opcionais: `PORT` (3000), `HOST` (0.0.0.0), `DB_PATH` (data/beco105.db), `SESSION_SECRET`
(se vazio, é gerado e guardado na própria base), `ADMIN_USER`/`ADMIN_PASSWORD` (criam o primeiro usuário no boot).

O servidor precisa ficar ligado enquanto o bar funciona: um PC/mini-PC/Raspberry no bar, ou uma hospedagem com Node.
Se o acesso for pela internet, coloque atrás de HTTPS (proxy com `X-Forwarded-Proto: https`; o cookie passa a ser `Secure`).
Faça cópia periódica do arquivo `data/beco105.db`.

## Abrir o mural na TV

1. No navegador da TV (ou de um mini-PC ligado nela), abra `http://ENDEREÇO-DO-SERVIDOR:3000/tv`.
2. Tela cheia: `F11`, ou tecla `F` na página (o navegador exige um gesto). Modo quiosque:
   `chromium --kiosk --noerrdialogs http://ENDEREÇO-DO-SERVIDOR:3000/tv`.
3. A TV não pede senha e ninguém precisa ficar na frente dela: consulta o servidor a cada 15 s
   e troca de página a cada 25 s (ajustável no celular).

## Atualizar pelo celular

1. Abra `http://ENDEREÇO-DO-SERVIDOR:3000/gestao`, entre com usuário e senha (dá para "adicionar à tela inicial").
2. Toque em **Aviso**, **Reserva**, **Pendência** ou **Rotina**, preencha o mínimo e confira a **prévia da TV**.
3. **Salvar e publicar**: a TV mostra em até ~30 s, sem ninguém mexer nela.
4. Para concluir: abra o item e toque em **Concluir agora** (um toque; aparece "Desfazer").
   Rotinas têm um registro por dia: **Concluir hoje** não conclui amanhã.
5. **Concluídos e histórico** e **Arquivados** ficam na tela inicial; **Ajustes da TV** muda o tempo por página e os turnos.

## Demonstração

```bash
npm run demo          # insere dados fictícios (e o usuário gerencia/beco105demo se não houver usuário: troque a senha!)
npm run demo:limpar   # apaga somente o que o demo inseriu
```

A TV mostra "DADOS DE DEMONSTRAÇÃO" no rodapé enquanto houver item de demonstração visível.

## Regras de exibição (resumo)

- Fuso `America/Sao_Paulo`. O **dia operacional vira às 05:00**: o turno da noite que passa da meia-noite continua no mesmo dia.
- **Avisos**: até 3 na TV, visíveis em todas as páginas (urgentes primeiro, depois fixados). Fora do período, somem sozinhos, inclusive com a TV sem conexão.
- **Reservas**: só as do dia, por horário; canceladas e concluídas saem. Telefone, contato e notas pessoais **nunca** vão para a TV (o servidor nem os envia). Um **evento** (tipo "Evento" no formulário de reserva) aparece em destaque sob a lista.
- **Pendências**: abertas, atrasadas e de prioridade alta primeiro; atrasadas continuam visíveis com o rótulo "Atrasada"; as críticas ficam fixas no topo das páginas (até metade da altura da coluna).
- **Rotinas**: a TV mostra as do turno atual e as pendentes que já passaram do horário; concluídas do turno vão ao fim, esmaecidas.
- **Páginas**: o excedente é distribuído pela **altura real medida** dos itens. Nenhuma fonte é reduzida, nada é cortado e nada rola. Tempo por página configurável (padrão 25 s).
- **Sem conexão**: a TV continua mostrando o último conteúdo, com faixa "DADOS DESATUALIZADOS" e o horário da última sincronização, e reconecta sozinha.
- "Nenhum item cadastrado" (lista vazia) e "Não foi possível carregar" (falha) são estados diferentes.

## Testes

```bash
npm test      # regras, paginação, API (login, CRUD, expiração, recorrência, persistência, falha de seção)
npm run e2e   # navegador real (Chromium/Playwright): TV com excesso, celular→TV, offline/recuperação, 4K
```

O e2e precisa de Playwright e Chromium já instalados (`PLAYWRIGHT_DIR` e `CHROMIUM` ajustam os caminhos).
As capturas de tela ficam em `test/e2e/out/`.

## Estrutura

```
server.js     servidor HTTP + arquivos estáticos
src/          banco (SQLite), autenticação, API, validação
shared/       regras puras usadas pelo servidor, pela TV e pela prévia (tempo, regras, paginação, HTML dos cartões)
public/       tv.*, gestao.*, fontes Barlow (licença OFL)
scripts/      usuario.js, demo.js
test/         testes automatizados
```

## Limitações conhecidas

- Se a TV for **recarregada ou reiniciada sem rede**, o navegador não abre a página (não há Service Worker). Só quem já está aberto resiste à queda.
- A gestão exige conexão para salvar (não há fila offline).
- Os horários, o tamanho das fontes e a legibilidade na distância real **ainda precisam de teste na TV de verdade**.
- Sem integração com sistemas de reserva, sem chat, ponto, estoque ou financeiro (fora do escopo).
- Usuários são criados/trocados por linha de comando (`npm run usuario`); não há tela de cadastro de usuários nem de recuperação de senha.
