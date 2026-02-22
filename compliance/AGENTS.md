# Compliance Agent Instructions

This folder tracks policy, procedure, and technical control mappings for compliance frameworks.

## Dependency Installation Policy

- It is always acceptable to install dependencies when needed to run tooling, tests, or scripts.
- Use `pnpm i` for a direct dependency install in the current workspace.
- Use `scripts/agents/refresh.sh` when a full workspace refresh is needed (main sync + install/build), especially after merges or large upstream changes.

## Infrastructure Configuration Locations

Infrastructure-as-code files that implement compliance controls are located in:

### `ansible/` - Configuration Management

Kubernetes and automation-host configuration:

- `ansible/playbooks/k8s.yml` - k3s host bootstrap (ingress, cert-manager, build tooling)
- `ansible/playbooks/tuxedo.yml` - Tuxedo automation host configuration
- `ansible/inventories/` - Dynamic inventories (`k8s`, `k8s-prod`, `tuxedo`)

Key compliance-relevant configurations:

- k3s bootstrap and control-plane readiness checks
- ingress and certificate manager installation
- buildkit/nerdctl installation for container build workflows
- deploy-key based GitHub access for automation hosts

### `terraform/` - Cloud Infrastructure

Primary cloud infrastructure provisioning using a modular, stack-based approach:

- `terraform/bootstrap/` - Backend state storage (S3/DynamoDB)
- `terraform/modules/` - Reusable infrastructure components (Hetzner, Azure, AWS, Cloudflare)
- `terraform/stacks/` - Environment-specific resource compositions (prod, staging, shared)
- `terraform/configs/` - Shared backend and provider configurations

Key compliance-relevant configurations:

- SSH-only access (password auth disabled in `hetzner-server` module)
- Non-root server user (cloud-init hardening)
- Managed identities and RBAC (Azure TEE module)
- State isolation and locking (S3/DynamoDB bootstrap)
- Container registry security (AWS ECR in `ci-artifacts` module)
- Network isolation (NSGs, Firewalls, Cloudflare Tunnels)

### `terraform/modules/azure-tee` - Azure Confidential VM (Trusted Execution Environment)

Confidential computing infrastructure for sensitive workloads:

- `terraform/modules/azure-tee/main.tf` - Confidential VM, Network, and Key Vault provisioning
- `terraform/stacks/*/tee/` - Environment-specific TEE deployments
- `terraform/stacks/*/tee/ansible/` - TEE API image provisioning
- `terraform/stacks/*/tee/scripts/` - Terraform and image build automation

Key compliance-relevant configurations:

- Hardware-based attestation (AMD SEV-SNP)
- Key Vault with RBAC authorization
- Network isolation (NSG rules)
- Managed identity for VM-to-KeyVault access

## Sentinel Standard

- Sentinel IDs are stable and policy-scoped: `TL-<policy>-<3 digits>` (example: `TL-ACCT-001`).
- Reuse the same sentinel ID across all files that implement the same control.
- Use this payload format in comments:
  - `COMPLIANCE_SENTINEL: <ID> | policy=<policy-doc> | procedure=<procedure-doc> | control=<short-name>`

## Comment Syntax By File Type

- Markdown (`.md`): `<!-- COMPLIANCE_SENTINEL: TL-ACCT-001 | ... -->`
- TypeScript/TSX (`.ts`, `.tsx`): `// COMPLIANCE_SENTINEL: TL-ACCT-001 | ...`
- YAML/Shell/Python (`.yml`, `.yaml`, `.sh`, `.py`): `# COMPLIANCE_SENTINEL: TL-ACCT-001 | ...`
- SQL (`.sql`): `-- COMPLIANCE_SENTINEL: TL-ACCT-001 | ...`
- Jinja templates (`.j2`): `{# COMPLIANCE_SENTINEL: TL-ACCT-001 | ... #}`
- Terraform (`.tf`): `# COMPLIANCE_SENTINEL: TL-ACCT-001 | ...`

## Infrastructure Sentinel Conventions

When adding sentinels to infrastructure-as-code, place them at the resource or block level that implements the control.

**Note**: The `policy` and `procedure` attributes are optional. Use the minimal format (`control` only) for initial sentinel placement, then add `policy` and `procedure` links when the corresponding compliance documents exist:

- Minimal: `COMPLIANCE_SENTINEL: TL-INFRA-001 | control=ssh-hardening`
- Full: `COMPLIANCE_SENTINEL: TL-INFRA-001 | policy=compliance/SOC2/policies/XX.md | procedure=compliance/SOC2/procedures/XX.md | control=ssh-hardening`

### Terraform Resources

```hcl
# COMPLIANCE_SENTINEL: TL-INFRA-001 | control=ssh-hardening
resource "hcloud_server" "main" {
  # ...
}
```

### Ansible Tasks

```yaml
# COMPLIANCE_SENTINEL: TL-INFRA-001 | control=ssh-hardening
- name: Disable root SSH login
  ansible.builtin.lineinfile:
    # ...
```

### Sentinel Prefixes by Domain

- `TL-ACCT-XXX` - Account management controls
- `TL-AUDT-XXX` - SOC2 audit logging controls
- `TL-NAUDT-XXX` - NIST audit logging controls
- `TL-HAUDT-XXX` - HIPAA audit logging controls
- `TL-INFRA-XXX` - Infrastructure hardening controls
- `TL-CRYPTO-XXX` - Cryptographic controls
- `TL-NET-XXX` - Network security controls
- `TL-DB-XXX` - Database security controls (RDS)
- `TL-PAY-XXX` - Payment infrastructure controls (RevenueCat)
- `TL-VENDOR-XXX` - Third-party vendor management controls

## Required Wiring Steps

1. Define or update the policy statement under `compliance/<framework>/policies/`.
2. Define or update procedure steps under `compliance/<framework>/procedures/`.
3. Update the technical control map under `compliance/<framework>/technical-controls/`.
4. Add sentinel comments at implementation points and, when practical, at test evidence points.
5. Run targeted tests and capture the command set in the procedure evidence log.

## Preen Follow-Up

After wiring new controls, run relevant preen skills to keep mappings current:

- `preen-typescript` for TypeScript control integrity
- `preen-api-security` for auth/account-control checks
- `preen` for broader stale control cleanup
