# Vendor Management Procedure (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-001 | policy=compliance/NIST.SP.800-53/policies/04-vendor-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-vendor-management-procedure.md | control=vendor-inventory -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-011 | policy=compliance/NIST.SP.800-53/policies/04-vendor-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-vendor-management-procedure.md | control=vendor-risk-assessment -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-012 | policy=compliance/NIST.SP.800-53/policies/04-vendor-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-vendor-management-procedure.md | control=vendor-due-diligence -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-013 | policy=compliance/NIST.SP.800-53/policies/04-vendor-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-vendor-management-procedure.md | control=vendor-monitoring -->

## Frequency

- Execute quarterly for external service inventory review.
- Execute before acquiring any new external service.
- Execute when external service capabilities change.
- Execute annually for supply chain risk re-assessment.

## Procedure Steps

### 1. External Services Inventory (`TL-VENDOR-001`) - SA-9, PM-30

1. Open the [Vendor Registry](../../vendor-registry.md).
2. Verify all external information system services are documented.
3. Confirm service boundaries and interfaces are defined.
4. Verify user roles for each external service.
5. Update inventory upon service changes.

### 2. Supply Chain Risk Assessment (`TL-VENDOR-011`) - SR-3, SR-5

1. For each external service, assess:
   - [ ] Supplier criticality to operations
   - [ ] Data sensitivity processed by supplier
   - [ ] Supplier security capability evidence
   - [ ] Geographic and jurisdictional risks
   - [ ] Single-source dependency risks
2. Document risk assessment findings.
3. Develop risk mitigation strategies for high-risk suppliers.

### 3. Acquisition Security Requirements (`TL-VENDOR-012`) - SA-4, SA-12

1. Before acquiring external services, verify:
   - [ ] Security requirements defined in acquisition documents
   - [ ] Supplier security certification evidence obtained
   - [ ] Component provenance verified (for critical systems)
   - [ ] Developer security testing evidence reviewed
2. Execute interconnection security agreement if applicable.
3. Document acquisition decision rationale.

### 4. Continuous Monitoring (`TL-VENDOR-013`) - CA-7, SA-9(2)

1. Review external service provider security posture quarterly.
2. Monitor for security advisories affecting external services.
3. Review external service audit logs (where available).
4. Assess impact of external service changes on organizational security.

### 5. Infrastructure Service Review

1. Review Terraform and Ansible configurations for external services:

```bash
# Hetzner Cloud infrastructure (verify SSH key usage)
grep -r "hcloud_ssh_key" terraform/

# Azure TEE infrastructure (verify confidential VM and RBAC)
grep -r "confidential_vm" terraform/modules/azure-tee/
grep -r "rbac_authorization_enabled = true" terraform/modules/azure-tee/

# Ansible server configuration (verify security settings)
grep -r "PermitRootLogin no" ansible/playbooks/main.yml
```

1. Verify security controls are implemented per policy.

## Verification Commands

```bash
# List all vendor sentinels
grep -r "TL-VENDOR" compliance/

# Verify infrastructure configurations
terraform -chdir=terraform validate
terraform -chdir=tee validate

# Review external service integrations
grep -r "OPENROUTER\|REVENUECAT" packages/api/
```

## Evidence Template

- Assessment date:
- Assessor:
- Controls verified: `TL-VENDOR-001`, `TL-VENDOR-011`, `TL-VENDOR-012`, `TL-VENDOR-013`
- External services reviewed:
- Supply chain risks identified:
- Mitigation actions required:
- POA&M items:

## External Service Onboarding Checklist

- [ ] Service documented in vendor registry
- [ ] Supply chain risk assessment completed
- [ ] Security requirements documented
- [ ] Supplier security evidence obtained
- [ ] Interconnection agreement executed (if applicable)
- [ ] User roles and responsibilities defined
- [ ] Monitoring procedures established
- [ ] System Owner approval obtained
