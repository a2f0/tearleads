# Primeiros Passos

_Atualizado para refletir a versão em inglês de 11 de fevereiro de 2026._

```bash
pnpm install
pnpm dev
```

## Scripts de Desenvolvimento para Postgres

Use estes auxiliares se você estiver trabalhando localmente na integração com Postgres:

- `scripts/postgres/setupPostgresDev.sh` instala e inicia o Postgres no macOS e imprime os padrões PG* (incluindo `PGDATABASE=tearleads_development`).
- `scripts/postgres/runPostgresMigration.sh` executa as migrações pendentes do banco de dados (usa `DATABASE_URL` ou variáveis de ambiente PG*).
- `scripts/postgres/dropPostgresDb.ts` remove apenas `tearleads_development` (requer `--yes`).

## Chave de API do App Store Connect

Uma chave de API do App Store Connect é necessária para a automação de build do Fastlane.

1. Vá para [App Store Connect](https://appstoreconnect.apple.com/)
2. Navegue até **Users and Access** → guia **Integrations**
3. Clique em `Generate API Key` para criar uma nova chave de API
4. Dê um nome para ela (por exemplo, "GitHub Actions").
5. Defina a função como **App Manager**.
6. Baixe o arquivo `.p8` e coloque-o em `.secrets/`
7. Exporte `APP_STORE_CONNECT_KEY_ID` e `APP_STORE_CONNECT_ISSUER_ID`.
8. Use [scripts/setGithubVars.ts](../scripts/setGithubVars.ts) para implantá-la no GitHub.

## Token de Acesso Pessoal do GitHub

Um token de acesso pessoal é necessário para o Fastlane Match, que é usado para gerenciamento de certificados de assinatura e perfis de provisionamento. Para configurar:

1. Crie um novo repositório no GitHub
2. Vá para [Personal Access Tokens](https://github.com/settings/personal-access-tokens)
3. Conceda ao token as seguintes permissões:
  a. Acesso de leitura a metadados
  b. Acesso de leitura e escrita ao código
4. Codifique o token com `echo -n "<usuário do github>:<token de acesso pessoal>" | base64 | pbcopy` e defina-o em `MATCH_GIT_BASIC_AUTHORIZATION`
5. Use [scripts/setGithubVars.ts](../scripts/setGithubVars.ts) para configurá-lo no GitHub (para GitHub Actions).
