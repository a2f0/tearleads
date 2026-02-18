---
name: infra-bootstrap
description: Run staged Terraform and Ansible bootstrap flows for staging/prod clusters and VPN with retries and clear failure output.
---

# Infra Bootstrap

Use this skill to provision infrastructure and baseline config in a staged order using `agentTool.ts`.

## Safety Rules

1. Always run from repo root.
2. Dry-run first unless the user explicitly wants execution.
3. Use `--yes` for non-dry-run actions.
4. On failure, include the failing command and stdout/stderr in your response.
5. Retry failed apply/bootstrap steps once after a short wait.
6. Never run destroy unless the user explicitly asks for it.

## Actions

Use these wrappers:

- `runTerraformStackScript --stack <stack> --script <script>`
- `runAnsibleBootstrap --target <target>`

Allowlisted stacks/scripts:

- `staging/k8s`: `apply`, `apply01`, `apply02`, `apply03`, `destroy`
- `prod/k8s`: `apply`, `apply01`, `apply02`, `apply03`, `destroy`
- `prod/vpn`: `apply`, `apply01`, `apply02`, `destroy`

Allowlisted ansible targets:

- `staging-k8s`
- `prod-k8s`
- `prod-vpn`

## Recommended Sequences

### Staging K8s

1. `./scripts/agents/tooling/agentTool.ts runTerraformStackScript --stack staging/k8s --script apply01 --yes`
2. `./scripts/agents/tooling/agentTool.ts runTerraformStackScript --stack staging/k8s --script apply02 --yes`
3. `./scripts/agents/tooling/agentTool.ts runAnsibleBootstrap --target staging-k8s --yes`
4. `./scripts/agents/tooling/agentTool.ts runTerraformStackScript --stack staging/k8s --script apply03 --yes`

### Prod K8s

1. `./scripts/agents/tooling/agentTool.ts runTerraformStackScript --stack prod/k8s --script apply01 --yes`
2. `./scripts/agents/tooling/agentTool.ts runTerraformStackScript --stack prod/k8s --script apply02 --yes`
3. `./scripts/agents/tooling/agentTool.ts runAnsibleBootstrap --target prod-k8s --yes`
4. `./scripts/agents/tooling/agentTool.ts runTerraformStackScript --stack prod/k8s --script apply03 --yes`

### Prod VPN

1. `./scripts/agents/tooling/agentTool.ts runTerraformStackScript --stack prod/vpn --script apply01 --yes`
2. `./scripts/agents/tooling/agentTool.ts runAnsibleBootstrap --target prod-vpn --yes`
3. `./scripts/agents/tooling/agentTool.ts runTerraformStackScript --stack prod/vpn --script apply02 --yes`

## Retry Pattern

For each step:

1. Run the command.
2. If it fails, wait 10-20 seconds.
3. Run the same command once more.
4. If retry fails, stop sequence and report failure details.
