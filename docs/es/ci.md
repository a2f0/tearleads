# Descripción General de CI

Este repositorio utiliza selección de CI basada en impacto con una sola verificación de puerta.

## Flujo de alto nivel

1. `scripts/ciImpact/ciImpact.ts` analiza los archivos modificados y calcula las decisiones de trabajos (`jobs.<job>.run`).
2. Los flujos de trabajo de Release/E2E ejecutan `detect-impact` y omiten trabajos pesados cuando `should-run` es `false`.
3. `.github/workflows/ci-gate.yml` calcula los nombres de flujos de trabajo requeridos desde la salida de ciImpact y espera solo a que esos flujos reporten éxito.
4. La protección de rama debe requerir `CI Gate` (no cada flujo de trabajo condicional individual).

Esto proporciona el comportamiento "requerido si aplica" en la práctica.

## Comportamiento de CI Gate

Flujo de trabajo: `.github/workflows/ci-gate.yml`

- Disparador: `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`)
- Paso 1 (`Detect Required Workflows`):
  - Ejecuta `scripts/ciImpact/requiredWorkflows.ts` usando los SHAs base/head del PR
  - Produce una lista JSON de nombres de flujos de trabajo requeridos (para este PR)
- Paso 2 (`CI Gate`):
  - Consulta las ejecuciones de GitHub Actions para el SHA head del PR
  - Espera hasta que todos los flujos de trabajo requeridos estén `completed/success`
  - Falla si algún flujo de trabajo requerido falla
  - Falla por timeout si los flujos de trabajo requeridos nunca reportan

Debido a que `CI Gate` siempre está presente, puede configurar esto como la verificación requerida de protección de rama de forma segura, incluso cuando los flujos de trabajo individuales se omiten condicionalmente.

## Scripts de ciImpact

Analizador principal:

- `scripts/ciImpact/ciImpact.ts`
  - Entradas: diff base/head (o `--files` explícito)
  - Salidas:
    - `changedFiles`, `materialFiles`, `changedPackages`, `affectedPackages`
    - `jobs.<job>.run` y `jobs.<job>.reasons`

Ayudante de mapeo de puerta:

- `scripts/ciImpact/requiredWorkflows.ts`
  - Ejecuta `ciImpact.ts`
  - Mapea decisiones de trabajos a nombres de flujos de trabajo usados en GitHub Actions
  - Salidas:
    - `requiredWorkflows`
    - `reasons` (indexado por nombre de flujo de trabajo)

Selector de calidad local pre-push:

- `scripts/ciImpact/runImpactedQuality.ts`
  - Ejecuta lint/typecheck/build selectivo por impacto
  - Recurre al pipeline de calidad completo para cambios de alto riesgo

Selector de cobertura local pre-push:

- `scripts/ciImpact/runImpactedTests.ts`
  - Ejecuta `test:coverage` selectivo por paquete según impacto
  - Recurre a objetivos de cobertura completos para cambios de alto riesgo

## Cómo se aplica la selección de impacto

En flujos de trabajo de CI:

- Los flujos de trabajo E2E/release incluyen un trabajo `detect-impact` y ejecutan condicionalmente trabajos de prueba cuando el impacto lo requiere.

Localmente (git hooks):

- `.husky/pre-push` ejecuta:
  - `scripts/ciImpact/runImpactedQuality.ts`
  - `scripts/ciImpact/runImpactedTests.ts`

## Comandos útiles

Inspeccionar decisiones de trabajos para una rama:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD
```

Inspeccionar flujos de trabajo requeridos para evaluación de puerta:

```bash
pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --base origin/main --head HEAD
```

Simular con archivos explícitos:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "scripts/ciImpact/ciImpact.ts,.github/workflows/ci-gate.yml"
```

Verificar deriva de mapeo entre `ciImpact`, flujos de trabajo requeridos y archivos de flujo de trabajo:

```bash
pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
```

## Notas

- Si un commit cambia solo rutas ignoradas (por ejemplo, rutas de solo documentación configuradas en disparadores de flujo de trabajo), algunos flujos de trabajo pueden no reportar.
- `CI Gate` debe ser el requisito de merge para que los merges se bloqueen solo en resultados de flujos de trabajo relevantes para el PR.

## Manual de Operaciones

Cuando un flujo de trabajo se omitió o ejecutó inesperadamente, use este flujo:

1. Reproduzca la decisión localmente con archivos explícitos:

   ```bash
   pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "path/a.ts,path/b.ts"
   ```

2. Inspeccione `jobs.<job>.run` y `jobs.<job>.reasons` en la salida JSON.
3. Derive expectativas de puerta y verifique nombres de flujos de trabajo:

   ```bash
   pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --files "path/a.ts,path/b.ts"
   ```

4. Valide deriva de mapeo:

   ```bash
   pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
   ```

5. Si el comportamiento aún parece incorrecto, revise la salida de validación nocturna en los artefactos del flujo de trabajo `CI Impact Validation`.

Guía de ajuste seguro:

- Mantenga el comportamiento fail-open para archivos ambiguos (prefiera ejecuciones extra sobre ejecuciones perdidas).
- Actualice `scripts/ciImpact/job-groups.json` y la lógica en `scripts/ciImpact/ciImpact.ts` juntos.
- Agregue o actualice pruebas de escenario en:
  - `scripts/ciImpact/ciImpact.test.ts`
  - `scripts/ciImpact/requiredWorkflows.test.ts`
- Vuelva a ejecutar verificaciones de deriva + cobertura antes de hacer merge:

  ```bash
  pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
  node --import tsx --test scripts/ciImpact/ciImpact.test.ts scripts/ciImpact/requiredWorkflows.test.ts
  pnpm dlx c8 --reporter=text-summary node --import tsx --test scripts/ciImpact/ciImpact.test.ts scripts/ciImpact/requiredWorkflows.test.ts
  ```
