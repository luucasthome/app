# Começando no Windows (sem programar)

1. **Baixe o aplicativo**: na página do repositório no GitHub, clique em **Code ▸ Download ZIP** (na branch do pull request).
   Clique com o botão direito no ZIP ▸ **Extrair tudo** (ex.: `C:\mural-beco105`).
2. **Instale o Node.js** (versão LTS 22 ou mais nova): https://nodejs.org . Depois feche e abra as janelas.
3. Dentro da pasta extraída, dê **duplo clique em `iniciar-windows.bat`**.
   Na primeira vez ele pede usuário e senha da gerência. Deixe a janela preta aberta: ela é o servidor.
4. **TV**: no navegador da TV/PC ligado nela, abra `http://localhost:3000/tv` (F11 = tela cheia).
   **Celular** (no mesmo Wi-Fi): descubra o IP do PC (`ipconfig`, linha "Endereço IPv4", ex. 192.168.0.15)
   e abra `http://192.168.0.15:3000/gestao`. Se o Windows perguntar sobre o Firewall, permita redes privadas.
5. Para testar com dados fictícios: no Prompt de Comando, dentro da pasta, `npm run demo`
   (e `npm run demo:limpar` para apagar).

Para o servidor subir sozinho quando o PC ligar, coloque um atalho do `iniciar-windows.bat` em
`Win+R ▸ shell:startup`.
