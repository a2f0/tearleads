# Vendor Management Technical Control Map (NIST SP 800-53)

This map ties vendor management policy controls to NIST SP 800-53 requirements and implementation evidence.

## Sentinel Controls

| Sentinel | Description | NIST Controls | Implementation Evidence |
| --- | --- | --- | --- |
| `TL-VENDOR-001` | External services inventory | SA-9, PM-30 | `compliance/vendor-registry.md` |
| `TL-VENDOR-002` | Hetzner Cloud controls | SA-9, SC-7 | `terraform/modules/hetzner-server/main.tf`, `terraform/stacks/staging/k8s/main.tf` |
| `TL-VENDOR-003` | Azure TEE controls | SA-9, SC-28, SI-7 | `terraform/modules/azure-tee/main.tf` |
| `TL-VENDOR-004` | Let's Encrypt controls | SC-8, SC-13 | `terraform/stacks/staging/k8s/main.tf` |
| `TL-VENDOR-005` | GitHub controls | SA-9, CM-3 | `.github/workflows/` |
| `TL-VENDOR-006` | RevenueCat controls | SA-9, SC-8 | `packages/api/src/lib/revenuecat.ts` |
| `TL-VENDOR-007` | OpenRouter controls | SA-9, SC-8 | `packages/api/src/routes/chat/post-completions.ts` |
| `TL-VENDOR-008` | Anthropic controls | SA-9 | `CLAUDE.md` |
| `TL-VENDOR-009` | OpenAI controls | SA-9 | `AGENTS.md` |
| `TL-VENDOR-010` | Google controls | SA-9 | `.gemini/INSTRUCTIONS.md` |
| `TL-VENDOR-011` | Supply chain risk assessment | SR-3, SR-5, RA-3 | Risk assessment records |
| `TL-VENDOR-012` | Acquisition controls | SA-4, SA-12 | Acquisition documentation |
| `TL-VENDOR-013` | Continuous monitoring | CA-7, SA-9(2) | Monitoring logs |

## NIST Control Mapping

### SA-9: External System Services

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| (a) Require providers to comply with security requirements | Vendor registry documents requirements | `compliance/vendor-registry.md` |
| (b) Define user roles | Documented in vendor entries | Vendor registry |
| (c) Employ processes to monitor compliance | Quarterly review procedure | Review logs |

### SR-3: Supply Chain Controls and Processes

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| (a) Establish supply chain controls | Vendor tiering and assessment | Risk assessment summary |
| (b) Document selected controls | Technical control map | This document |
| (c) Implement controls | Infrastructure configurations | Terraform/Ansible files |

### SR-5: Acquisition Strategies, Tools, and Methods

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| (a) Employ acquisition strategies | Due diligence requirements | Vendor onboarding checklist |
| (b) Limit harm from supply chain threats | Tier-based requirements | Vendor registry tiers |

### CA-7: Continuous Monitoring

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| (a) Establish monitoring program | Quarterly vendor review | Review procedures |
| (b) Assess control effectiveness | Certification verification | Certificate archive |
| (c) Ongoing security monitoring | External service monitoring | Monitoring logs |

## Implementation Files

### Infrastructure Vendors (SA-9, SC-7)

| File | Vendor | Controls |
| --- | --- | --- |
| `terraform/modules/hetzner-server/main.tf` | Hetzner | Network boundary, access control |
| `terraform/modules/hetzner-dns/main.tf` | Hetzner | DNS security |
| `terraform/modules/azure-tee/main.tf` | Azure | Confidential computing |
| `terraform/modules/azure-tee/main.tf` | Azure | Key management |
| `terraform/modules/azure-tee/main.tf` | Azure | Network security |

### Platform Service Vendors (SA-9, SC-8)

| File | Vendor | Controls |
| --- | --- | --- |
| `packages/api/src/lib/revenuecat.ts` | RevenueCat | Webhook integrity |
| `packages/api/src/routes/chat/post-completions.ts` | OpenRouter | API security |
| `.github/workflows/` | GitHub | CI/CD security |

### Development Tool Vendors (SA-9)

| File | Vendor | Purpose |
| --- | --- | --- |
| `CLAUDE.md` | Anthropic | Agent configuration |
| `AGENTS.md` | OpenAI | Agent configuration |
| `.gemini/INSTRUCTIONS.md` | Google | Review configuration |

## Evidence Collection

```bash
# Verify external services inventory
cat compliance/vendor-registry.md | grep "^### "

# Check infrastructure security controls
grep -r "TL-INFRA\|TL-NET\|TL-CRYPTO" terraform/modules/

# Verify API security implementations
grep -r "verify\|sign\|auth" packages/api/src/lib/

# List CI/CD workflow security
ls -la .github/workflows/
```

## Compliance Verification

- [ ] All external services documented (SA-9)
- [ ] Supply chain risks assessed (SR-3, SR-5)
- [ ] Security requirements in acquisitions (SA-4)
- [ ] Monitoring procedures established (CA-7)
- [ ] Interconnection agreements in place (CA-3)
