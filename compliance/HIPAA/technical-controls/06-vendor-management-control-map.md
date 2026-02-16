# Vendor Management Technical Control Map (HIPAA)

This map ties vendor management policy controls to HIPAA Security Rule requirements and implementation evidence.

## Sentinel Controls

| Sentinel | Description | HIPAA Standard | Implementation Evidence |
| --- | --- | --- | --- |
| `TL-VENDOR-001` | Business Associate inventory | 164.308(b)(1) | `compliance/vendor-registry.md` |
| `TL-VENDOR-002` | Hetzner Cloud controls | 164.312(a)(1), 164.312(e)(1) | `terraform/modules/hetzner-server/main.tf`, `ansible/playbooks/main.yml` |
| `TL-VENDOR-003` | Azure TEE controls | 164.312(a)(2)(iv), 164.312(e)(2)(ii) | `terraform/modules/azure-tee/main.tf` |
| `TL-VENDOR-004` | Let's Encrypt controls | 164.312(e)(1) | `ansible/playbooks/main.yml` |
| `TL-VENDOR-005` | GitHub controls | 164.312(a)(1), 164.308(a)(4) | `.github/workflows/` |
| `TL-VENDOR-006` | RevenueCat controls | 164.312(e)(1), 164.312(c)(1) | `packages/api/src/lib/revenuecat.ts` |
| `TL-VENDOR-007` | OpenRouter controls | 164.312(e)(1) | `packages/api/src/routes/chat/post-completions.ts` |
| `TL-VENDOR-008` | Anthropic controls | 164.308(b)(1) | `CLAUDE.md` |
| `TL-VENDOR-009` | OpenAI controls | 164.308(b)(1) | `AGENTS.md` |
| `TL-VENDOR-010` | Google controls | 164.308(b)(1) | `.gemini/INSTRUCTIONS.md` |
| `TL-VENDOR-011` | PHI access risk assessment | 164.308(a)(1)(ii)(A) | Risk assessment records |
| `TL-VENDOR-012` | BAA requirements | 164.308(b)(3), 164.314(a) | BAA archive |
| `TL-VENDOR-013` | BA monitoring | 164.308(a)(8) | Monitoring logs |

## HIPAA Standard Mapping

### 164.308(b) - Business Associate Contracts

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| (1) Written contract or arrangement | BAA requirement in policy | `compliance/vendor-registry.md` |
| (3) Satisfactory assurances | Due diligence procedure | Vendor onboarding checklist |

### 164.314(a) - Business Associate Contract Requirements

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| (1) Contract must contain required elements | BAA template with HIPAA provisions | BAA archive |
| (2)(i) Subcontractor requirements | Policy statement on flow-down | Policy section `VENDOR-05` |
| (2)(ii) Termination provisions | Termination procedure | Procedure section 5 |

### 164.308(a)(1)(ii)(A) - Risk Analysis

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Conduct accurate risk analysis | PHI access risk assessment | Risk assessment template |

### 164.308(a)(8) - Evaluation

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Periodic technical/nontechnical evaluation | Annual BA review | Monitoring procedure |

## Vendor PHI Access Matrix

| Vendor | PHI Access | BAA Required | Security Controls |
| --- | --- | --- | --- |
| Hetzner Cloud | None (infrastructure only) | No | Access controls, encryption at rest |
| Microsoft Azure | None (TEE infrastructure) | Available | Confidential computing, Key Vault |
| GitHub | None (source code only) | No | Access controls, secret scanning |
| RevenueCat | None (billing IDs only) | No | Webhook signature verification |
| OpenRouter | None (no PHI in prompts) | No | API authentication |
| Anthropic | None (development only) | No | Data isolation |
| OpenAI | None (development only) | No | Data isolation |
| Google | None (code review only) | No | Data isolation |

## Technical Safeguards by Vendor

### Infrastructure Vendors (164.312)

| File | Vendor | Safeguard |
| --- | --- | --- |
| `terraform/modules/hetzner-server/main.tf` | Hetzner | Access control (a)(1) |
| `terraform/modules/azure-tee/main.tf` | Azure | Encryption (a)(2)(iv) |
| `terraform/modules/azure-tee/main.tf` | Azure | Encryption key management |
| `ansible/playbooks/main.yml` | Hetzner | Audit controls (b) |

### Transmission Security (164.312(e)(1))

| File | Vendor | Control |
| --- | --- | --- |
| `ansible/playbooks/main.yml` | Let's Encrypt | TLS certificates |
| `packages/api/src/lib/revenuecat.ts` | RevenueCat | HTTPS webhook |
| `packages/api/src/routes/chat/post-completions.ts` | OpenRouter | HTTPS API |

## Evidence Collection

```bash
# Verify no PHI in codebase
grep -ri "ssn\|social.security\|diagnosis\|medical.record" packages/ --include="*.ts"

# Verify transmission security
grep -r "https://" packages/api/src/

# Check encryption configurations
grep -r "encrypt\|cipher\|tls\|ssl" terraform/modules/
```

## Compliance Notes

### Current PHI Status

The Tearleads application does not currently process, store, or transmit Protected Health Information (PHI). This vendor management control map is prepared for:

1. Compliance readiness if PHI processing is introduced
2. Demonstration of HIPAA-aware vendor management practices
3. Framework for future Business Associate management

### BAA Readiness

If PHI processing is introduced, the following vendors offer BAA options:

- **Microsoft Azure**: Standard HIPAA BAA available
- **Hetzner Cloud**: Custom agreement may be required (EU-based)
- **GitHub**: Enterprise BAA available

## Compliance Verification

- [ ] All vendors classified for PHI access
- [ ] No vendors have unauthorized PHI access
- [ ] BAAs in place for any Business Associates
- [ ] Annual BA review completed
- [ ] Breach notification procedures documented
