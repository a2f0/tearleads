# Visao Geral do CI

Este repositorio usa selecao de CI baseada em impacto com uma unica verificacao de porta.

## Fluxo de alto nivel

1. `scripts/ciImpact/ciImpact.ts` analisa os arquivos alterados e calcula as decisoes de jobs (`jobs.<job>.run`).
2. Os workflows de Release/E2E executam `detect-impact` e pulam jobs pesados quando `should-run` e `false`.
3. `.github/workflows/ci-gate.yml` calcula os nomes de workflows necessarios a partir da saida do ciImpact e aguarda apenas esses workflows reportarem sucesso.
4. A protecao de branch deve exigir `CI Gate` (nao cada workflow condicional individual).

Isso proporciona o comportamento "obrigatorio se aplicavel" na pratica.

## Comportamento do CI Gate

Workflow: `.github/workflows/ci-gate.yml`

- Gatilho: `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`)
- Etapa 1 (`Detect Required Workflows`):
  - Executa `scripts/ciImpact/requiredWorkflows.ts` usando os SHAs base/head do PR
  - Produz uma lista JSON de nomes de workflows necessarios (para este PR)
- Etapa 2 (`CI Gate`):
  - Consulta as execucoes do GitHub Actions para o SHA head do PR
  - Aguarda ate que todos os workflows necessarios estejam `completed/success`
  - Falha se algum workflow necessario falhar
  - Falha por timeout se os workflows necessarios nunca reportarem

Como o `CI Gate` esta sempre presente, voce pode seguramente tornar esta a verificacao obrigatoria de protecao de branch, mesmo quando workflows individuais sao condicionalmente pulados.

## Scripts do ciImpact

Analisador principal:

- `scripts/ciImpact/ciImpact.ts`
  - Entradas: diff base/head (ou `--files` explicito)
  - Saidas:
    - `changedFiles`, `materialFiles`, `changedPackages`, `affectedPackages`
    - `jobs.<job>.run` e `jobs.<job>.reasons`

Auxiliar de mapeamento de porta:

- `scripts/ciImpact/requiredWorkflows.ts`
  - Executa `ciImpact.ts`
  - Mapeia decisoes de jobs para nomes de workflows usados no GitHub Actions
  - Saidas:
    - `requiredWorkflows`
    - `reasons` (indexado por nome de workflow)

Seletor de qualidade local pre-push:

- `scripts/ciImpact/runImpactedQuality.ts`
  - Executa lint/typecheck/build seletivo por impacto
  - Recorre ao pipeline de qualidade completo para mudancas de alto risco

Seletor de cobertura local pre-push:

- `scripts/ciImpact/runImpactedTests.ts`
  - Executa `test:coverage` seletivo por pacote baseado em impacto
  - Recorre a alvos de cobertura completos para mudancas de alto risco

## Como a selecao de impacto e aplicada

Em workflows de CI:

- Workflows E2E/release incluem um job `detect-impact` e executam condicionalmente jobs de teste quando o impacto exige.

Localmente (git hooks):

- `.husky/pre-push` executa:
  - `scripts/ciImpact/runImpactedQuality.ts`
  - `scripts/ciImpact/runImpactedTests.ts`

## Comandos uteis

Inspecionar decisoes de jobs para um branch:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD
```

Inspecionar workflows necessarios para avaliacao de porta:

```bash
pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --base origin/main --head HEAD
```

Simular com arquivos explicitos:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "scripts/ciImpact/ciImpact.ts,.github/workflows/ci-gate.yml"
```

Verificar deriva de mapeamento entre `ciImpact`, workflows necessarios e arquivos de workflow:

```bash
pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
```

## Notas

- Se um commit altera apenas caminhos ignorados (por exemplo, caminhos somente de documentacao configurados em gatilhos de workflow), alguns workflows podem nao reportar.
- `CI Gate` deve ser o requisito de merge para que merges sejam bloqueados apenas em resultados de workflows relevantes para o PR.

## Manual de Operacoes

Quando um workflow pulou ou executou inesperadamente, use este fluxo:

1. Reproduza a decisao localmente com arquivos explicitos:

   ```bash
   pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "path/a.ts,path/b.ts"
   ```

2. Inspecione `jobs.<job>.run` e `jobs.<job>.reasons` na saida JSON.
3. Derive expectativas de porta e verifique nomes de workflows:

   ```bash
   pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --files "path/a.ts,path/b.ts"
   ```

4. Valide deriva de mapeamento:

   ```bash
   pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
   ```

5. Se o comportamento ainda parecer incorreto, verifique a saida de validacao noturna nos artefatos do workflow `CI Impact Validation`.

Guia de ajuste seguro:

- Mantenha o comportamento fail-open para arquivos ambiguos (prefira execucoes extras a execucoes perdidas).
- Atualize `scripts/ciImpact/job-groups.json` e a logica em `scripts/ciImpact/ciImpact.ts` juntos.
- Adicione ou atualize testes de cenario em:
  - `scripts/ciImpact/ciImpact.test.ts`
  - `scripts/ciImpact/requiredWorkflows.test.ts`
- Execute novamente verificacoes de deriva + cobertura antes de fazer merge:

  ```bash
  pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
  node --import tsx --test scripts/ciImpact/ciImpact.test.ts scripts/ciImpact/requiredWorkflows.test.ts
  pnpm dlx c8 --reporter=text-summary node --import tsx --test scripts/ciImpact/ciImpact.test.ts scripts/ciImpact/requiredWorkflows.test.ts
  ```
