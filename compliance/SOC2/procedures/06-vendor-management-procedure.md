# Vendor Management Procedure (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-001 | policy=compliance/SOC2/policies/04-vendor-management-policy.md | procedure=compliance/SOC2/procedures/04-vendor-management-procedure.md | control=vendor-inventory -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-011 | policy=compliance/SOC2/policies/04-vendor-management-policy.md | procedure=compliance/SOC2/procedures/04-vendor-management-procedure.md | control=vendor-risk-assessment -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-012 | policy=compliance/SOC2/policies/04-vendor-management-policy.md | procedure=compliance/SOC2/procedures/04-vendor-management-procedure.md | control=vendor-due-diligence -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-013 | policy=compliance/SOC2/policies/04-vendor-management-policy.md | procedure=compliance/SOC2/procedures/04-vendor-management-procedure.md | control=vendor-monitoring -->

## Frequency

- Execute quarterly for vendor registry review.
- Execute before onboarding any new vendor.
- Execute when vendor services or data access changes materially.
- Execute annually for certification verification.

## Procedure Steps

### 1. Vendor Inventory Review (`TL-VENDOR-001`) - CC9.2

1. Open the [Vendor Registry](../../vendor-registry.md).
2. Verify all active vendors are documented with required fields.
3. Confirm data classification and tier assignments are current.
4. Check for vendors no longer in use and mark for offboarding.
5. Update "Last Review" date upon completion.

### 2. Vendor Risk Assessment (`TL-VENDOR-011`) - CC3.2, CC9.2

1. For new vendors, complete the risk assessment checklist:
   - [ ] Data sensitivity classification determined
   - [ ] Business criticality evaluated (critical/non-critical)
   - [ ] Replaceability assessed (high/medium/low)
   - [ ] Vendor security posture reviewed
2. Assign vendor tier based on risk matrix.
3. Document risk assessment in vendor registry entry.

### 3. Due Diligence Verification (`TL-VENDOR-012`) - CC9.2

1. For Tier 1/2 vendors, collect compliance evidence:
   - [ ] SOC 2 Type II report (or equivalent)
   - [ ] ISO 27001 certificate (if applicable)
   - [ ] Security questionnaire responses
2. Verify DPA is executed for vendors processing personal data.
3. Review vendor privacy policy and terms of service.
4. Document evidence location and expiration dates.

### 4. Ongoing Monitoring (`TL-VENDOR-013`) - CC4.1, CC9.2

1. Check vendor certification expiration dates quarterly.
2. Review vendor security advisories and incident notifications.
3. Verify SLA compliance for Tier 1 vendors.
4. Document any vendor security incidents and resolution.

### 5. Certification Verification

1. For each Tier 1/2 vendor, verify current compliance certification:

| Vendor | Certification | Verification Method |
| --- | --- | --- |
| Hetzner Cloud | SOC 2 Type II, ISO 27001 | Request from vendor |
| Microsoft Azure | SOC 2, ISO 27001, HIPAA | Azure compliance portal |
| GitHub | SOC 2 Type II | GitHub security page |
| RevenueCat | SOC 2 Type II | Request from vendor |
| Anthropic | SOC 2 Type II | Anthropic security page |

### 6. Infrastructure Vendor Configuration Audit

1. Review Terraform configurations for security controls:

```bash
# Verify Hetzner SSH key configuration
grep -r "hcloud_ssh_key" terraform/

# Verify Azure Key Vault RBAC
grep -r "enable_rbac_authorization" tee/
```

1. Review Ansible playbooks for hardening controls:

```bash
# Verify SSH hardening
grep -r "PermitRootLogin" ansible/
```

## Verification Commands

```bash
# List all vendor-related compliance sentinels
grep -r "TL-VENDOR" compliance/

# Verify vendor registry exists and has content
wc -l compliance/vendor-registry.md

# Check infrastructure vendor configurations
ls -la terraform/*.tf tee/*.tf
```

## Evidence Template

- Review date:
- Reviewer:
- Controls verified: `TL-VENDOR-001`, `TL-VENDOR-011`, `TL-VENDOR-012`, `TL-VENDOR-013`
- Vendors reviewed:
- Certifications verified:
- Issues identified:
- Remediation tasks:

## Vendor Onboarding Checklist

New vendor onboarding requires completion of all applicable items:

- [ ] Vendor added to registry with all required fields
- [ ] Risk assessment completed and tier assigned
- [ ] Compliance certification verified (Tier 1/2)
- [ ] DPA executed (if processing personal data)
- [ ] Technical integration reviewed by Engineering
- [ ] Security controls documented
- [ ] Environment variables documented (if API keys required)
- [ ] Approval obtained from Security Owner

## Vendor Offboarding Checklist

Vendor offboarding requires completion of:

- [ ] Data return or destruction confirmed
- [ ] API keys and credentials revoked
- [ ] Vendor access to systems removed
- [ ] Vendor registry entry updated with end date
- [ ] Offboarding documented
