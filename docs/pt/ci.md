# Visão Geral do CI

Este repositório usa seleção de CI baseada em impacto com uma única verificação de porta.

## Fluxo de alto nível

1. `scripts/ciImpact/ciImpact.ts` analisa os arquivos alterados e calcula as decisões de jobs (`jobs.<job>.run`).
2. Os workflows de Release/E2E executam `detect-impact` e pulam jobs pesados quando `should-run` é `false`.
3. `.github/workflows/ci-gate.yml` calcula os nomes de workflows necessários a partir da saída do ciImpact e aguarda apenas esses workflows reportarem sucesso.
4. A proteção de branch deve exigir `CI Gate` (não cada workflow condicional individual).

Isso proporciona o comportamento "obrigatório se aplicável" na prática.

## Comportamento do CI Gate

Workflow: `.github/workflows/ci-gate.yml`

- Gatilho: `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`)
- Etapa 1 (`Detect Required Workflows`):
  - Executa `scripts/ciImpact/requiredWorkflows.ts` usando os SHAs base/head do PR
  - Produz uma lista JSON de nomes de workflows necessários (para este PR)
- Etapa 2 (`CI Gate`):
  - Consulta as execuções do GitHub Actions para o SHA head do PR
  - Aguarda até que todos os workflows necessários estejam `completed/success`
  - Falha se algum workflow necessário falhar
  - Falha por timeout se os workflows necessários nunca reportarem

Como o `CI Gate` está sempre presente, você pode seguramente tornar esta a verificação obrigatória de proteção de branch, mesmo quando workflows individuais são condicionalmente pulados.

## Scripts do ciImpact

Analisador principal:

- `scripts/ciImpact/ciImpact.ts`
  - Entradas: diff base/head (ou `--files` explícito)
  - Saídas:
    - `changedFiles`, `materialFiles`, `changedPackages`, `affectedPackages`
    - `jobs.<job>.run` e `jobs.<job>.reasons`

Auxiliar de mapeamento de porta:

- `scripts/ciImpact/requiredWorkflows.ts`
  - Executa `ciImpact.ts`
  - Mapeia decisões de jobs para nomes de workflows usados no GitHub Actions
  - Saídas:
    - `requiredWorkflows`
    - `reasons` (indexado por nome de workflow)

Seletor de qualidade local pré-push:

- `scripts/ciImpact/runImpactedQuality.ts`
  - Executa lint/typecheck/build seletivo por impacto
  - Recorre ao pipeline de qualidade completo para mudanças de alto risco

Seletor de cobertura local pré-push:

- `scripts/ciImpact/runImpactedTests.ts`
  - Executa `test:coverage` seletivo por pacote baseado em impacto
  - Recorre a alvos de cobertura completos para mudanças de alto risco

## Como a seleção de impacto é aplicada

Em workflows de CI:

- Workflows E2E/release incluem um job `detect-impact` e executam condicionalmente jobs de teste quando o impacto exige.

Localmente (git hooks):

- `.husky/pre-push` executa:
  - `scripts/ciImpact/runImpactedQuality.ts`
  - `scripts/ciImpact/runImpactedTests.ts`

## Comandos úteis

Inspecionar decisões de jobs para um branch:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD
```

Inspecionar workflows necessários para avaliação de porta:

```bash
pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --base origin/main --head HEAD
```

Simular com arquivos explícitos:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "scripts/ciImpact/ciImpact.ts,.github/workflows/ci-gate.yml"
```

Verificar deriva de mapeamento entre `ciImpact`, workflows necessários e arquivos de workflow:

```bash
pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
```

## Notas

- Se um commit altera apenas caminhos ignorados (por exemplo, caminhos somente de documentação configurados em gatilhos de workflow), alguns workflows podem não reportar.
- `CI Gate` deve ser o requisito de merge para que merges sejam bloqueados apenas em resultados de workflows relevantes para o PR.

## Manual de Operações

Quando um workflow pulou ou executou inesperadamente, use este fluxo:

1. Reproduza a decisão localmente com arquivos explícitos:

   ```bash
   pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "path/a.ts,path/b.ts"
   ```

2. Inspecione `jobs.<job>.run` e `jobs.<job>.reasons` na saída JSON.
3. Derive expectativas de porta e verifique nomes de workflows:

   ```bash
   pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --files "path/a.ts,path/b.ts"
   ```

4. Valide deriva de mapeamento:

   ```bash
   pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
   ```

5. Se o comportamento ainda parecer incorreto, verifique a saída de validação noturna nos artefatos do workflow `CI Impact Validation`.

Guia de ajuste seguro:

- Mantenha o comportamento fail-open para arquivos ambíguos (prefira execuções extras a execuções perdidas).
- Atualize `scripts/ciImpact/job-groups.json` e a lógica em `scripts/ciImpact/ciImpact.ts` juntos.
- Adicione ou atualize testes de cenário em:
  - `scripts/ciImpact/ciImpact.test.ts`
  - `scripts/ciImpact/requiredWorkflows.test.ts`
- Execute novamente verificações de deriva + cobertura antes de fazer merge:

  ```bash
  pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
  pnpm exec tsx scripts/ciImpact/runImpactedTests.ts --base origin/main --head HEAD --scripts-only
  pnpm dlx c8 --reporter=text-summary node --import tsx --test scripts/ciImpact/ciImpact.test.ts scripts/ciImpact/requiredWorkflows.test.ts
  ```
