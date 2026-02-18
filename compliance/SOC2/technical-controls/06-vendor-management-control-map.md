# Vendor Management Technical Control Map (SOC2)

This map ties vendor management policy controls to concrete implementation and evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Review Evidence |
| --- | --- | --- | --- |
| `TL-VENDOR-001` | Vendor inventory maintenance | [`compliance/vendor-registry.md`](../../vendor-registry.md) | Quarterly review logs |
| `TL-VENDOR-002` | Hetzner Cloud vendor controls | [`terraform/modules/hetzner-server/main.tf`](../../../terraform/modules/hetzner-server/main.tf), [`terraform/modules/hetzner-dns/main.tf`](../../../terraform/modules/hetzner-dns/main.tf), [`terraform/stacks/staging/k8s/main.tf`](../../../terraform/stacks/staging/k8s/main.tf) | Terraform state, SSH audit |
| `TL-VENDOR-003` | Microsoft Azure vendor controls | [`terraform/modules/azure-tee/main.tf`](../../../terraform/modules/azure-tee/main.tf) | Azure compliance portal |
| `TL-VENDOR-004` | Let's Encrypt vendor controls | [`terraform/stacks/staging/k8s/main.tf`](../../../terraform/stacks/staging/k8s/main.tf) (certbot tasks) | Certificate transparency logs |
| `TL-VENDOR-005` | GitHub vendor controls | [`.github/workflows/`](../../../.github/workflows), repository settings | GitHub audit log |
| `TL-VENDOR-006` | RevenueCat vendor controls | [`packages/api/src/lib/revenuecat.ts`](../../../packages/api/src/lib/revenuecat.ts), [`packages/api/src/routes/revenuecat/`](../../../packages/api/src/routes/revenuecat) | Webhook test suite |
| `TL-VENDOR-007` | OpenRouter vendor controls | [`packages/api/src/routes/chat/postCompletions.ts`](../../../packages/api/src/routes/chat/postCompletions.ts) | API usage logs |
| `TL-VENDOR-008` | Anthropic vendor controls | [`CLAUDE.md`](../../../CLAUDE.md), [`.claude/skills/`](../../../.claude/skills) | Development session logs |
| `TL-VENDOR-009` | OpenAI vendor controls | [`AGENTS.md`](../../../AGENTS.md), [`.codex/skills/`](../../../.codex/skills) | Development session logs |
| `TL-VENDOR-010` | Google Gemini vendor controls | [`.gemini/INSTRUCTIONS.md`](../../../.gemini/INSTRUCTIONS.md) | PR review comments |
| `TL-VENDOR-011` | Vendor risk assessment | [`compliance/vendor-registry.md`](../../vendor-registry.md) (Risk Assessment Summary) | Risk assessment records |
| `TL-VENDOR-012` | Vendor due diligence | Vendor compliance certificates | Certificate archive |
| `TL-VENDOR-013` | Vendor monitoring | Quarterly review process | Review evidence logs |

## Implementation Files by Vendor

### Hetzner Cloud (`TL-VENDOR-002`)

| File | Control | Description |
| --- | --- | --- |
| `terraform/modules/hetzner-server/main.tf` | SSH key authentication | SSH key-only access via `hcloud_ssh_key` |
| `terraform/modules/hetzner-server/main.tf` | Server hardening | Cloud-init with root disabled, non-root user |
| `terraform/modules/hetzner-dns/main.tf` | DNS management | Hetzner DNS zone configuration |
| `terraform/stacks/*/outputs.tf` | Resource tracking | Server IP and resource outputs |
| `terraform/stacks/staging/k8s/main.tf` | Server configuration | nginx, PostgreSQL, Redis, API services |

### Microsoft Azure (`TL-VENDOR-003`)

| File | Control | Description |
| --- | --- | --- |
| `terraform/modules/azure-tee/main.tf` | Confidential VM | AMD SEV-SNP, vTPM, Secure Boot |
| `terraform/modules/azure-tee/main.tf` | Key Vault | RBAC authorization, secrets management |
| `terraform/modules/azure-tee/main.tf` | Network security | NSG with deny-by-default, explicit allows |
| `terraform/modules/azure-tee/main.tf` | Identity management | User-assigned managed identity |

### GitHub (`TL-VENDOR-005`)

| File | Control | Description |
| --- | --- | --- |
| `.github/workflows/ci-gate.yml` | CI quality gates | Automated testing and linting |
| `.github/workflows/deploy-web.yml` | Deployment automation | Controlled deployment pipelines |
| Repository settings | Access control | Branch protection, required reviews |

### RevenueCat (`TL-VENDOR-006`)

| File | Control | Description |
| --- | --- | --- |
| `packages/api/src/lib/revenuecat.ts` | Webhook verification | HMAC-SHA256 signature validation |
| `packages/api/src/routes/revenuecat/postWebhooks.ts` | Event processing | Idempotent webhook handling |
| `packages/db/src/schema/definition.ts` | Data storage | Billing tables with audit trail |

### OpenRouter (`TL-VENDOR-007`)

| File | Control | Description |
| --- | --- | --- |
| `packages/api/src/routes/chat/postCompletions.ts` | API integration | Authenticated API calls |
| `packages/api/.env.example` | Secret management | API key configuration |

### AI Development Tools (`TL-VENDOR-008`, `TL-VENDOR-009`, `TL-VENDOR-010`)

| File | Vendor | Description |
| --- | --- | --- |
| [`CLAUDE.md`](../../../CLAUDE.md) | Anthropic | Claude Code agent instructions |
| `.claude/skills/` | Anthropic | Custom Claude Code skills |
| [`AGENTS.md`](../../../AGENTS.md) | OpenAI | Codex agent instructions |
| `.codex/skills/` | OpenAI | Custom Codex skills |
| `.gemini/INSTRUCTIONS.md` | Google | Gemini Code Assist review instructions |

## Configuration Evidence

### Environment Variables by Vendor

| Vendor | Variable | Purpose |
| --- | --- | --- |
| Hetzner | `hcloud_token` | Terraform provider authentication |
| Azure | Azure CLI credentials | Terraform provider authentication |
| RevenueCat | `REVENUECAT_WEBHOOK_SECRET` | Webhook signature verification |
| OpenRouter | `OPENROUTER_API_KEY` | API authentication |

## SOC2 TSC Mapping

| Sentinel | TSC Controls | Rationale |
| --- | --- | --- |
| `TL-VENDOR-001` | CC9.2 | Third-party vendor inventory maintained |
| `TL-VENDOR-002` | CC6.1, CC6.6, CC9.2 | Infrastructure vendor security controls |
| `TL-VENDOR-003` | CC6.1, CC6.7, CC9.2 | Confidential computing vendor controls |
| `TL-VENDOR-004` | CC6.7, CC9.2 | TLS certificate vendor |
| `TL-VENDOR-005` | CC6.1, CC8.1, CC9.2 | CI/CD and code repository vendor |
| `TL-VENDOR-006` | CC6.1, CC6.6, CC9.2 | Payment platform vendor |
| `TL-VENDOR-007` | CC6.7, CC9.2 | AI API vendor |
| `TL-VENDOR-008` | CC9.2 | Development tool vendor |
| `TL-VENDOR-009` | CC9.2 | Development tool vendor |
| `TL-VENDOR-010` | CC9.2 | Code review tool vendor |
| `TL-VENDOR-011` | CC3.2, CC9.2 | Vendor risk assessment |
| `TL-VENDOR-012` | CC9.2 | Vendor due diligence |
| `TL-VENDOR-013` | CC4.1, CC9.2 | Vendor monitoring |

## Evidence Collection Commands

```bash
# Verify vendor registry is populated
cat compliance/vendor-registry.md | grep -c "^###"

# Check Hetzner Terraform configuration
terraform -chdir=terraform/stacks/prod/k8s show -json 2>/dev/null | jq '.values.root_module.resources[] | select(.type | startswith("hcloud"))' || echo "Run terraform init first"

# Check Azure Terraform configuration
terraform -chdir=terraform/stacks/prod/tee show -json 2>/dev/null | jq '.values.root_module.resources[] | select(.type | startswith("azurerm"))' || echo "Run terraform init first"

# Verify RevenueCat integration tests pass
pnpm --filter @tearleads/api test -- src/routes/revenuecat.test.ts

# List all vendor-related sentinels in codebase
grep -r "TL-VENDOR" --include="*.tf" --include="*.yml" --include="*.ts" --include="*.md" .
```

## Compliance Verification Checklist

- [ ] Vendor registry reviewed and updated
- [ ] All Tier 1/2 vendor certifications current
- [ ] DPAs in place for vendors processing personal data
- [ ] Infrastructure vendor configurations audited
- [ ] API vendor integrations reviewed for security
- [ ] Development tool vendors documented
