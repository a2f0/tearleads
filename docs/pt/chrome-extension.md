# Extensão do Chrome

_Atualizado para refletir a versão em inglês de 11 de fevereiro de 2026._

A extensão do Chrome do Tearleads está localizada em `packages/chrome-extension`. Ela usa Manifest V3 e é construída com Vite e TypeScript.

## Estrutura do Projeto

```text
packages/chrome-extension/
├── public/
│   ├── manifest.json      # Manifesto da extensão do Chrome
│   └── icons/             # Ícones da extensão (SVG)
├── src/
│   ├── background/        # Service worker (executa em segundo plano)
│   ├── content/           # Script de conteúdo (injetado nas páginas)
│   ├── popup/             # Script de UI do popup
│   ├── popup.html         # HTML do popup
│   └── messages.ts        # Tipos de mensagens compartilhados
├── dist/                  # Saída de build (carregue isto no Chrome)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## Desenvolvimento

### Build

```bash
# Build único
pnpm --filter @tearleads/chrome-extension build

# Modo watch (rebuild quando arquivos mudam)
pnpm --filter @tearleads/chrome-extension dev
```

### Carregar no Chrome (Modo Desenvolvedor)

1. Faça o build da extensão (ou execute em modo watch)
2. Abra o Chrome e navegue para `chrome://extensions`
3. Ative **Developer mode** (alternância no canto superior direito)
4. Clique em **Load unpacked**
5. Selecione a pasta `packages/chrome-extension/dist`
6. A extensão deve aparecer na sua lista de extensões

Quando executando em modo watch (`pnpm dev`), a extensão recompila automaticamente após mudanças de arquivo. Depois das mudanças:

- **Script de background:** Clique no ícone de atualizar no cartão da extensão em `chrome://extensions`.
- **Script de conteúdo:** Recarregue a página de destino.
- **Popup:** Feche e abra novamente o popup.

### Testes

```bash
# Executar testes uma vez
pnpm --filter @tearleads/chrome-extension test

# Modo watch
pnpm --filter @tearleads/chrome-extension test:watch

# Com relatório de cobertura
pnpm --filter @tearleads/chrome-extension test:coverage
```

## Arquitetura

### Manifest V3

A extensão usa [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3), a plataforma mais recente de extensões do Chrome:

- **Service Worker**: O script de background executa como service worker (`background.js`)
- **Content Scripts**: Restritos a domínios específicos (`*.tearleads.app` e `localhost`)
- **Permissões**: Permissões mínimas (`storage`, `activeTab`)

### Componentes

| Componente | Arquivo | Finalidade |
| --------- | ---- | ------- |
| Background | `src/background/index.ts` | Service worker que gerencia eventos da extensão e roteamento de mensagens |
| Script de Conteúdo | `src/content/index.ts` | Injetado em páginas correspondentes para interagir com o conteúdo da página |
| Popup | `src/popup/index.ts` | UI exibida ao clicar no ícone da extensão |

### Troca de Mensagens

Os componentes se comunicam pela API de passagem de mensagens do Chrome. Os tipos de mensagens são definidos em `src/messages.ts`:

```typescript
// Exemplo: Enviar mensagem do popup para o background
chrome.runtime.sendMessage({ type: "PING" }, (response) => {
  console.log(response); // { type: "PONG" }
});
```

## Deploy

### Chrome Web Store

Para publicar na Chrome Web Store:

1. Faça o build da extensão: `pnpm --filter @tearleads/chrome-extension build`
2. Crie um arquivo ZIP com o conteúdo da pasta `dist` (o arquivo `manifest.json` deve estar na raiz do ZIP).
3. Envie para o [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)

### Incremento de Versão

A versão da extensão é gerenciada por `scripts/bumpVersion.sh`, que atualiza ambos:

- `packages/chrome-extension/package.json`
- `packages/chrome-extension/public/manifest.json`

Execute na raiz do repositório:

```bash
./scripts/bumpVersion.sh
```

## Depuração

### Service Worker de Background

1. Vá para `chrome://extensions`
2. Encontre a extensão Tearleads
3. Clique no link **Service Worker** para abrir o DevTools do script de background

### Script de Conteúdo

1. Abra o DevTools em uma página onde o script de conteúdo executa
2. Logs do script de conteúdo aparecem no console da página
3. Use o painel **Sources** para definir breakpoints em scripts de conteúdo

### Popup

1. Clique no ícone da extensão para abrir o popup
2. Clique com o botão direito dentro do popup e selecione **Inspect**
3. O DevTools abre para o contexto do popup
