# Огляд CI

Цей репозиторій використовує вибір CI на основі впливу з єдиною перевіркою шлюзу.

## Загальний потік

1. `scripts/ciImpact/ciImpact.ts` аналізує змінені файли та обчислює рішення про завдання (`jobs.<job>.run`).
2. Робочі процеси Release/E2E запускають `detect-impact` та пропускають важкі завдання, коли `should-run` дорівнює `false`.
3. `.github/workflows/ci-gate.yml` обчислює імена необхідних робочих процесів з виводу ciImpact та очікує лише на успіх цих робочих процесів.
4. Захист гілки повинен вимагати `CI Gate` (не кожен окремий умовний робочий процес).

Це забезпечує поведінку "обов'язково, якщо застосовується" на практиці.

## Поведінка CI Gate

Робочий процес: `.github/workflows/ci-gate.yml`

- Тригер: `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`)
- Крок 1 (`Detect Required Workflows`):
  - Запускає `scripts/ciImpact/requiredWorkflows.ts` використовуючи SHA base/head PR
  - Створює JSON-список необхідних імен робочих процесів (для цього PR)
- Крок 2 (`CI Gate`):
  - Опитує запуски GitHub Actions для head SHA PR
  - Очікує, поки всі необхідні робочі процеси стануть `completed/success`
  - Завершується невдачею, якщо будь-який необхідний робочий процес не вдається
  - Завершується невдачею по таймауту, якщо необхідні робочі процеси ніколи не звітують

Оскільки `CI Gate` завжди присутній, ви можете безпечно зробити це обов'язковою перевіркою захисту гілки, навіть коли окремі робочі процеси умовно пропускаються.

## Скрипти ciImpact

Основний аналізатор:

- `scripts/ciImpact/ciImpact.ts`
  - Входи: diff base/head (або явний `--files`)
  - Виходи:
    - `changedFiles`, `materialFiles`, `changedPackages`, `affectedPackages`
    - `jobs.<job>.run` та `jobs.<job>.reasons`

Допоміжний мапер шлюзу:

- `scripts/ciImpact/requiredWorkflows.ts`
  - Запускає `ciImpact.ts`
  - Мапить рішення про завдання на імена робочих процесів, що використовуються в GitHub Actions
  - Виходи:
    - `requiredWorkflows`
    - `reasons` (за ключем імені робочого процесу)

Локальний селектор якості pre-push:

- `scripts/ciImpact/runImpactedQuality.ts`
  - Запускає вибірковий lint/typecheck/build за впливом
  - Повертається до повного конвеєра якості для змін з високим ризиком

Локальний селектор покриття pre-push:

- `scripts/ciImpact/runImpactedTests.ts`
  - Запускає вибірковий `test:coverage` пакету за впливом
  - Повертається до повних цілей покриття для змін з високим ризиком

## Як застосовується вибір за впливом

У робочих процесах CI:

- Робочі процеси E2E/release включають завдання `detect-impact` та умовно запускають тестові завдання, коли вплив цього вимагає.

Локально (git hooks):

- `.husky/pre-push` запускає:
  - `scripts/ciImpact/runImpactedQuality.ts`
  - `scripts/ciImpact/runImpactedTests.ts`

## Корисні команди

Перевірити рішення про завдання для гілки:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --base origin/main --head HEAD
```

Перевірити необхідні робочі процеси для оцінки шлюзу:

```bash
pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --base origin/main --head HEAD
```

Симулювати з явними файлами:

```bash
pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "scripts/ciImpact/ciImpact.ts,.github/workflows/ci-gate.yml"
```

Перевірити дрейф мапінгу між `ciImpact`, необхідними робочими процесами та файлами робочих процесів:

```bash
pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
```

## Примітки

- Якщо коміт змінює лише ігноровані шляхи (наприклад, шляхи тільки для документації, налаштовані в тригерах робочих процесів), деякі робочі процеси можуть не звітувати.
- `CI Gate` повинен бути вимогою для злиття, щоб злиття блокувалися лише на відповідних результатах робочих процесів для PR.

## Інструкція з експлуатації

Коли робочий процес несподівано пропустився або запустився, використовуйте цей потік:

1. Відтворіть рішення локально з явними файлами:

   ```bash
   pnpm exec tsx scripts/ciImpact/ciImpact.ts --files "path/a.ts,path/b.ts"
   ```

2. Перевірте `jobs.<job>.run` та `jobs.<job>.reasons` у JSON-виводі.
3. Виведіть очікування шлюзу та перевірте імена робочих процесів:

   ```bash
   pnpm exec tsx scripts/ciImpact/requiredWorkflows.ts --files "path/a.ts,path/b.ts"
   ```

4. Перевірте дрейф мапінгу:

   ```bash
   pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
   ```

5. Якщо поведінка все ще виглядає неправильною, перевірте вивід нічної валідації в артефактах робочого процесу `CI Impact Validation`.

Керівництво з безпечного налаштування:

- Зберігайте поведінку fail-open для неоднозначних файлів (віддавайте перевагу зайвим запускам над пропущеними).
- Оновлюйте `scripts/ciImpact/job-groups.json` та логіку в `scripts/ciImpact/ciImpact.ts` разом.
- Додавайте або оновлюйте сценарні тести в:
  - `scripts/ciImpact/ciImpact.test.ts`
  - `scripts/ciImpact/requiredWorkflows.test.ts`
- Повторно запустіть перевірки дрейфу + покриття перед злиттям:

  ```bash
  pnpm exec tsx scripts/ciImpact/checkWorkflowDrift.ts
  node --import tsx --test scripts/ciImpact/ciImpact.test.ts scripts/ciImpact/requiredWorkflows.test.ts
  pnpm dlx c8 --reporter=text-summary node --import tsx --test scripts/ciImpact/ciImpact.test.ts scripts/ciImpact/requiredWorkflows.test.ts
  ```
