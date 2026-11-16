# Mesa D&D 5e

Fichas de D&D 5e e mesa multiplayer em tempo real, feitas para celular (mobile-first). Um servidor Node.js com Socket.io sincroniza tudo entre o Mestre e os jogadores. O cliente é um único arquivo `index.html`, que também funciona como app instalável (PWA).

Versão: **2.0.0**

---

## Estrutura dos arquivos

| Arquivo | Função |
|---|---|
| `server.js` | Servidor HTTP + Socket.io: salas, Mestre, jogadores, mapa, marcadores e backup |
| `index.html` | Todo o cliente: interface, fichas, painel do Mestre e mapa (HTML, CSS e JS) |
| `package.json` | Dependências (`socket.io`) e comando `npm start` |
| `manifest.json` | Configuração do app instalável (nome, ícone, cores) |
| `icon.png` | Ícone do app |

---

## Como rodar

### Localmente (Termux ou computador)
```
npm install
npm start
```
Abra `http://localhost:3000` (ou `http://IP-DO-PC:3000` no celular, na mesma rede).

### Na nuvem (Render)
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- Envie na raiz do repositório: `server.js`, `index.html`, `package.json`, `manifest.json` e `icon.png`.

A porta é lida de `process.env.PORT`, então nenhuma configuração extra é necessária.

---

## Fichas de personagem

- **Várias fichas no mesmo aparelho:** criar, trocar, excluir.
- **Identidade:** nome, raça, classe, nível, XP, antecedente, tendência e foto (a foto fica só no aparelho; para os outros aparece uma miniatura).
- **Atributos** com modificadores calculados automaticamente.
- **Condições:** lista de condições de D&D, exaustão (1 a 6) e campo livre de efeitos.
- **Combate:** pontos de vida (atual, máximo e temporário), CA, iniciativa, deslocamento, bônus de proficiência e percepção passiva calculados.
- **Dados de vida** (tipo, total e gastos) e **testes de morte** (sucessos e falhas).
- **Descanso longo:** recupera HP e metade dos dados de vida, zera os testes de morte e recupera os espaços de magia.
- **Perícias:** 18 perícias com proficiência e maestria; o bônus é calculado automaticamente.
- **Ataques** (nome, bônus, dano e tipo), **inventário** (quantidade e peso, com total) e **moedas** (cobre a platina, com valor total em po).
- **Magias:** atributo de conjuração, CD de resistência e bônus de ataque mágico, espaços de magia do 1º ao 9º nível (gastar e recuperar) e lista de magias preparadas.
- **Exportar e importar** a ficha em `.JSON`.

---

## Mesa multiplayer

### Lobby
- **Criar Nova Mesa:** gera um código de 4 caracteres e torna você o **Mestre**. Há botão para copiar o código.
- **Entrar em Mesa:** digite o código, escolha a ficha a usar (ou crie uma nova) e o nome do personagem. Você entra como **Jogador**.
- **Restaurar mesa de arquivo:** recria uma mesa a partir de um backup salvo pelo Mestre (veja "Backup da mesa").
- **Indicador de conexão** com o servidor.

### Regras de papel
- Só existe **um Mestre por mesa**. Quem cria a mesa recebe um token secreto; nenhum outro cliente consegue virar Mestre.
- Quem entra pelo código é sempre Jogador.
- Até **12 jogadores** por mesa.
- Ao sair e voltar, o app reconecta automaticamente (o navegador lembra a mesa e o personagem).

---

## Painel do Mestre (aba "Mesa")

- **Cards** de cada jogador com nome, indicador online/offline, classe e nível, **CA**, barra de HP (atual/máximo, com temporário) e botões **−5, −1, +1, +5**.
- As alterações de HP chegam ao celular do jogador na hora.
- **Abrir ficha completa:** gaveta lateral só de leitura, com todas as informações do personagem.
- **✎ Editar ficha completa:** o Mestre entra na própria ficha do jogador e altera **tudo** (todas as abas). As mudanças são enviadas automaticamente e aparecem na ficha do jogador. Se o jogador estiver offline, a edição é aplicada quando ele reconectar.
- Mesmo um jogador que ainda não enviou a ficha pode ter a ficha criada pelo Mestre.

---

## Mapa interativo (aba "Mapa")

### Navegação (estilo mapas de celular)
- Arrastar com um dedo para explorar.
- Zoom com pinça (ou roda do mouse no computador) e botões **+** e **−**.
- Botão **◎ Centralizar**: no jogador, centraliza no próprio personagem; no Mestre, percorre os personagens.

### Mapa (Mestre)
- **🖼 Carregar mapa:** envia uma imagem JPG ou PNG para todos da mesa (a imagem é reduzida para no máximo 2400 px). Ao carregar, o Mestre informa quantos pixels tem 1 quadrado (5 pés).
- **▦ Tamanho do quadrado:** ajusta a grade depois.

### Tokens
- O Mestre arrasta os tokens dos jogadores; todos veem o movimento em tempo real.
- Os jogadores veem o próprio token destacado e **não conseguem mover** nenhum token.

### Marcadores (📌, Mestre)
- Toque no mapa para criar um marcador com tipo (**Taverna, Armadilha, Chefe, Tesouro, Local**), título e descrição.
- Todos tocam no pin para ver a descrição. O Mestre pode editar e excluir.

### Régua de distância (📏)
- Toque e arraste para medir. Mostra quadrados, pés e metros.
- A medição é local: cada pessoa vê a própria.

---

## Notificações (toasts)

Os jogadores recebem avisos como:
- "O Mestre atualizou sua ficha!"
- "Novo marcador adicionado ao mapa"
- "O Mestre atualizou o mapa"
- "O Mestre se desconectou" / "O Mestre voltou à mesa"

---

## Backup da mesa

- **💾 Salvar** (só Mestre): baixa um arquivo `mesa-CODIGO-data.json` com as fichas dos jogadores, o mapa, os marcadores, as posições dos tokens e o token do Mestre.
- **📂 Restaurar mesa de arquivo** (tela inicial): recria a mesa com o mesmo código e os mesmos jogadores.
  - Se a mesa já estiver ativa e o arquivo for dela (mesmo token), o Mestre retoma o controle.
  - Os jogadores entram de novo com o mesmo código e o personagem volta.
- Salve a mesa ao fim de cada sessão. O que mudou depois do último backup não é recuperado.
- Backups feitos antes da versão que guarda o token não permitem retomar uma mesa que ainda está ativa.

---

## Instalação no celular (PWA)

- **Android (Chrome):** botão **📲 Instalar App** no topo, ou menu ⋮ > "Instalar app".
- **iPhone (Safari):** Compartilhar > "Adicionar à Tela de Início".

---

## Limitações

- **Dados em memória:** mesas, marcadores e mapa ficam no servidor. Reiniciar o servidor apaga tudo; use o backup para restaurar.
- **Plano gratuito do Render:** o serviço hiberna sem uso, e a primeira conexão pode levar até 1 minuto.
- **Sem senha:** quem tiver o código de 4 letras entra como jogador.
- **Fichas visíveis entre jogadores:** o servidor envia as fichas completas para o Mestre; jogadores não têm tela para ver as dos outros, mas o dado trafega.
- **Mesa encerrada:** 30 minutos depois que todos saem, a mesa é apagada do servidor.
- **Edição simultânea:** se Mestre e jogador editarem a mesma ficha ao mesmo tempo, vale a última alteração.
- **Armazenamento local:** as fichas ficam no navegador (limite de cerca de 5 MB); exporte em JSON para garantir uma cópia.
- **Sem modo offline:** o app precisa de internet, e a fonte Cinzel vem do Google Fonts.
- **Sem histórico, chat ou rolagem de dados** integrada.

---

## Tecnologias

- Node.js + Socket.io (servidor e comunicação em tempo real)
- HTML, CSS e JavaScript puros (cliente, sem frameworks)
- Google Fonts (Cinzel)
