# Primeros Pasos

```bash
pnpm install
pnpm dev
```

## Scripts de desarrollo para Postgres

Use estos helpers si trabaja con Postgres en local:

- `scripts/setupPostgresDev.sh` instala e inicia Postgres en macOS y muestra los valores PG* por defecto (incluye `PGDATABASE=tearleads_development`).
- `scripts/applyPostgresSchema.ts` aplica el esquema generado (usa `DATABASE_URL` o variables PG*).
- `scripts/dropPostgresDb.ts` elimina solo `tearleads_development` (requiere `--yes`).

## Clave API de App Store Connect

Se necesita una clave API de App Store Connect para la automatización de compilación de Fastlane.

1. Vaya a [App Store Connect](https://appstoreconnect.apple.com/)
2. Navegue a **Usuarios y Acceso** → pestaña **Integraciones**
3. Haga clic en `Generar Clave API` para crear una nueva clave API
4. Asígnele un nombre (por ejemplo, "GitHub Actions").
5. Establezca el rol como **App Manager**.
6. Descargue el archivo `.p8` y colóquelo en `.secrets/`
7. Exporte `APP_STORE_CONNECT_KEY_ID` y `APP_STORE_CONNECT_ISSUER_ID`.
8. Use [scripts/setGithubVars.sh](../scripts/setGithubVars.sh) para desplegarlo en GitHub.

## Token de Acceso Personal de GitHub

Se requiere un token de acceso personal para Fastlane Match, que se utiliza para la gestión de certificados de firma y perfiles de aprovisionamiento. Para configurar esto:

1. Cree un nuevo Repositorio de GitHub
2. Vaya a [Tokens de Acceso Personal](https://github.com/settings/personal-access-tokens)
3. Otorgue al token los siguientes permisos:
  a. Acceso de lectura a metadatos
  b. Acceso de lectura y escritura al código
4. Codifique el token con `echo -n "<usuario de github>:<token de acceso personal>" | base64 | pbcopy` y asígnelo a `MATCH_GIT_BASIC_AUTHORIZATION`
5. Use [scripts/setGithubVars.sh](../scripts/setGithubVars.sh) para configurarlo en GitHub (para GitHub Actions).
