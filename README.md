# Follow

Aplicativo web de Kanban para uma pessoa organizar vários projetos e tarefas, com prioridades, prazos e
checklists. Interface em português do Brasil, pensada para computador e celular.

Cada conta enxerga **somente os próprios dados** (a restrição é aplicada no servidor, em toda consulta).

## Escolha técnica (resumo)

| Parte | Tecnologia | Por quê |
|---|---|---|
| Servidor | Node.js 22 + Express | Um único processo, fácil de entender e de hospedar. |
| Banco | SQLite (`better-sqlite3`) | Um arquivo, sem serviço externo, transações simples. Ótimo para uso pessoal. |
| Login | Senha com `scrypt` + sessão em cookie `HttpOnly` | Sem dependência de terceiros; senha nunca é guardada em texto. |
| Interface | JavaScript puro (módulos ES), sem etapa de build | Nada para compilar: editou, recarregou. |
| Arrastar e soltar | SortableJS | Funciona com mouse e toque (no celular, segure o cartão por um instante). |
| E-mail | Nodemailer (SMTP) | Usado só na recuperação de senha. |

## Executar localmente

Requisitos: Node.js 22 ou superior.

```bash
npm install
cp .env.example .env     # opcional: os valores padrão já funcionam
npm start                # http://localhost:3000
```

Use `npm run dev` para reiniciar o servidor automaticamente ao editar o código.

Sem `SMTP_URL`, o e-mail de recuperação de senha **não é enviado**: o link aparece no terminal onde o
servidor está rodando (modo desenvolvimento). Copie e abra no navegador.

## Configuração

Tudo por variáveis de ambiente (arquivo `.env` ou painel da hospedagem). Nada de segredo fica no código.

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor. |
| `NODE_ENV` | — | Use `production` em produção (cookie `Secure` e HSTS). |
| `BASE_URL` | `http://localhost:PORT` | Endereço público do app. Entra nos links de recuperação de senha. **Obrigatório em produção** (use `https://`). |
| `DATABASE_PATH` | `./data/follow.db` | Arquivo SQLite. Em produção, aponte para um disco persistente. |
| `SMTP_URL` | vazio | Ex.: `smtp://usuario:senha@smtp.seuservico.com:587`. Sem isso o link só vai para o log. |
| `MAIL_FROM` | `Follow <nao-responder@localhost>` | Remetente dos e-mails. |
| `TRUST_PROXY` | `0` | Defina `1` atrás de proxy reverso (Render, Fly, Railway, Nginx…) para o limite de tentativas de login enxergar o IP real. |

## Publicar

O app precisa de **um servidor Node com disco persistente** (o banco é um arquivo). Plataformas como
Fly.io, Railway ou Render (plano com disco), ou uma VPS, servem. Serviços "serverless" sem disco
(Vercel, Netlify) **não** servem para esta versão.

1. Defina `NODE_ENV=production`, `BASE_URL=https://seu-dominio`, `TRUST_PROXY=1`, `SMTP_URL` e `MAIL_FROM`.
2. Monte um volume e aponte `DATABASE_PATH` para ele (ex.: `/data/follow.db`).
3. Comando de build: `npm ci --omit=dev`. Comando de início: `npm start`.
4. Sirva por HTTPS (as plataformas acima já fazem isso).

Com Docker, há um `Dockerfile` pronto (o banco fica em `/data`):

```bash
docker build -t follow .
docker run -d -p 3000:3000 -v follow-dados:/data \
  -e BASE_URL=https://seu-dominio -e TRUST_PROXY=1 -e SMTP_URL=... follow
```

> O `Dockerfile` não foi construído durante o desenvolvimento (o ambiente tinha só o cliente Docker, sem o serviço). Os mesmos passos (`npm ci --omit=dev` + `node server/index.js`) foram executados diretamente e funcionam.

**Backup:** copie o arquivo definido em `DATABASE_PATH` (com o app parado, ou use `sqlite3 follow.db ".backup copia.db"`).

## Versão HTML única (sem servidor)

Além da versão com servidor, o Follow também pode ser gerado como **um único arquivo**, `standalone/follow.html`,
que não precisa de Node, banco nem internet. Ele usa exatamente a mesma interface, mas **guarda os dados no
próprio navegador** (`localStorage`).

```bash
npm run build:standalone   # gera standalone/follow.html (o arquivo gerado também está versionado)
```

Como usar: dê duplo clique no arquivo, ou publique-o como página estática (GitHub Pages, Netlify, Cloudflare Pages…
basta enviar o arquivo). Funciona offline, sem custo.

O que muda em relação à versão com servidor:

| | Com servidor | HTML único |
|---|---|---|
| Conta, login e recuperação de senha | sim | **não** (não há conta; é um espaço pessoal) |
| Dados | no servidor, acessíveis de qualquer aparelho | **só neste navegador, neste aparelho** |
| Isolamento entre contas | validado no servidor | não se aplica (um único espaço por navegador) |
| Backup | cópia do arquivo do banco | botões **Exportar** / **Importar** (arquivo `.json`) |

Cuidados importantes:

- **Faça backup com frequência** (Exportar). Limpar os dados do navegador apaga tudo, e alguns navegadores
  (como o Safari no iPhone) podem descartar dados de sites que ficam muito tempo sem uso.
- Abrir o arquivo do disco e abrir o mesmo arquivo hospedado em um endereço web são **espaços separados**
  (cada endereço tem seu armazenamento). Para levar os dados de um para o outro, use Exportar e Importar.
- Celular e computador **não sincronizam**; para isso, use a versão com servidor.
- Importar um backup substitui tudo, mas o arquivo é validado antes (e a confirmação só aparece se for válido).

## Testes

```bash
npm test                    # 29 testes: API (login, projetos, tarefas, ordenação, isolamento entre contas) e camada local
npm run test:e2e            # navegador real (Chromium via Playwright): versão com servidor, computador e celular
npm run build:standalone && npm run test:e2e:standalone   # idem para o HTML único, aberto por file://
```

O teste de navegador precisa do Chromium do Playwright (`npx playwright install chromium`). Ele sobe um
servidor temporário com banco em memória e grava capturas de tela em `test-results/`.

## Estrutura

```
server/
  index.js          # ponto de entrada
  app.js            # Express: segurança (CSP, CSRF), rotas, tratamento de erros
  auth.js           # hash de senha, sessões
  data.js           # acesso a dados (sempre filtrando por user_id)
  db.js             # esquema SQLite e migrações
  validate.js       # validação de entradas
  routes/           # auth, projects, tasks
public/
  index.html, css/app.css
  js/main.js        # roteador e estrutura da página
  js/api.js         # cliente da API do servidor (no HTML único é trocado por js/local-api.js)
  js/views/         # telas: acesso, projetos, quadro, painel da tarefa
scripts/            # build do HTML único
standalone/         # follow.html gerado
test/               # testes de API e de navegador
```

## Como funciona (pontos importantes)

- **Sem duplicidade por cliques repetidos:** o navegador gera o identificador de cada projeto/tarefa antes
  de enviar; repetir o mesmo envio devolve o item já criado em vez de criar outro. Os botões também ficam
  desabilitados enquanto salvam.
- **Falha ao salvar:** o painel/formulário continua aberto com o que foi digitado e mostra o erro.
- **Posição das tarefas:** a ordem é gravada no servidor (movimento otimista na tela, com reversão se falhar).
- **Atrasada:** prazo anterior a hoje e tarefa fora de "Concluído". "Hoje" é a data do navegador.
- **Progresso do projeto:** tarefas em "Concluído" ÷ total (0% sem tarefas).
- **Arquivar:** o projeto sai da lista de ativos e fica somente leitura, com todas as tarefas; "Restaurar" o devolve.
- **Projeto demonstrativo:** só é criado quando a pessoa pede; aparece com a etiqueta "Exemplo" e é excluído em Configurações.
- **Segurança:** senhas com scrypt; cookie `HttpOnly` + `SameSite=Lax`; escritas só aceitas como JSON e da mesma
  origem; CSP restritiva; limite de tentativas em login/recuperação; link de recuperação de uso único, válido por 1 hora, e que encerra as sessões abertas.

## Limitações conhecidas (versão 1)

- **Um único servidor / SQLite:** adequado para uso pessoal e poucos usuários; não escala horizontalmente.
- **Recuperação de senha exige SMTP** configurado fora do desenvolvimento.
- **Campo de data nativo:** o seletor segue o idioma do navegador (em navegadores em português aparece
  dia/mês/ano); abaixo dele o app sempre mostra a data por extenso em dia/mês/ano.
- **Arrastar no celular:** é preciso segurar o cartão por um instante; entre colunas distantes, use o campo "Coluna" do cartão.
- **Cadastro revela e-mails já cadastrados** (mensagem "e-mail já cadastrado"); a recuperação de senha, não.
- Sem confirmação de e-mail, sem troca de senha dentro do app, sem compartilhamento entre pessoas (previstos para versões futuras).
