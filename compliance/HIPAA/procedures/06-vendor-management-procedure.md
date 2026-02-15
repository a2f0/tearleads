# Vendor Management Procedure (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-001 | policy=compliance/HIPAA/policies/04-vendor-management-policy.md | procedure=compliance/HIPAA/procedures/04-vendor-management-procedure.md | control=vendor-inventory -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-011 | policy=compliance/HIPAA/policies/04-vendor-management-policy.md | procedure=compliance/HIPAA/procedures/04-vendor-management-procedure.md | control=vendor-risk-assessment -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-012 | policy=compliance/HIPAA/policies/04-vendor-management-policy.md | procedure=compliance/HIPAA/procedures/04-vendor-management-procedure.md | control=vendor-due-diligence -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-013 | policy=compliance/HIPAA/policies/04-vendor-management-policy.md | procedure=compliance/HIPAA/procedures/04-vendor-management-procedure.md | control=vendor-monitoring -->

## Frequency

- Execute annually for Business Associate inventory review.
- Execute before any vendor is granted PHI access.
- Execute when vendor services change to include PHI.
- Execute upon notification of Business Associate security incident.

## Procedure Steps

### 1. Business Associate Inventory (`TL-VENDOR-001`) - 164.308(b)(1)

1. Open the [Vendor Registry](../../vendor-registry.md).
2. Review each vendor for PHI access classification:
   - [ ] Direct access to PHI
   - [ ] Potential incidental access to PHI
   - [ ] No PHI access
3. Verify BAA status for all Business Associates.
4. Update classifications based on current service scope.

### 2. PHI Access Risk Assessment (`TL-VENDOR-011`) - 164.308(a)(1)(ii)(A)

1. For vendors requesting PHI access, complete risk assessment:
   - [ ] PHI types to be accessed identified
   - [ ] Access methods documented (API, database, file transfer)
   - [ ] Minimum necessary access defined
   - [ ] Vendor security controls evaluated
   - [ ] Breach likelihood and impact assessed
2. Document risk assessment findings.
3. Obtain Privacy Officer approval for PHI access.

### 3. BAA Execution (`TL-VENDOR-012`) - 164.308(b)(3), 164.314(a)

1. Before granting PHI access, verify BAA requirements:
   - [ ] BAA includes permitted uses and disclosures
   - [ ] BAA includes safeguards requirements
   - [ ] BAA includes breach reporting obligations (60-day notification)
   - [ ] BAA includes subcontractor flow-down requirements
   - [ ] BAA includes termination provisions
2. Execute BAA with appropriate signatories.
3. File executed BAA with compliance records.
4. Record BAA status in vendor registry.

### 4. Business Associate Monitoring (`TL-VENDOR-013`) - 164.308(a)(8)

1. Review Business Associate compliance annually:
   - [ ] Security controls still adequate
   - [ ] No unreported security incidents
   - [ ] Subcontractor requirements being met
   - [ ] PHI use within permitted scope
2. Document any compliance concerns.
3. Initiate remediation for identified issues.

### 5. Breach Notification Coordination

1. Upon Business Associate breach notification:
   - [ ] Document breach details received
   - [ ] Verify breach investigation is underway
   - [ ] Assess individual notification requirements
   - [ ] Coordinate HHS notification if required
   - [ ] Document breach in security incident log
2. Track breach to resolution.

## Verification Commands

```bash
# List all vendor sentinels
grep -r "TL-VENDOR" compliance/

# Verify vendor registry exists
cat compliance/vendor-registry.md | head -50

# Check for PHI-related configurations
grep -ri "phi\|hipaa\|protected.health" packages/ --include="*.ts"
```

## Evidence Template

- Review date:
- Reviewer:
- Controls verified: `TL-VENDOR-001`, `TL-VENDOR-011`, `TL-VENDOR-012`, `TL-VENDOR-013`
- Business Associates reviewed:
- BAAs verified:
- PHI access changes:
- Compliance concerns:
- Remediation tasks:

## Business Associate Onboarding Checklist

- [ ] Vendor identified as Business Associate
- [ ] PHI access risk assessment completed
- [ ] Minimum necessary access defined
- [ ] BAA drafted with required provisions
- [ ] Legal review completed
- [ ] BAA executed by authorized signatories
- [ ] Vendor registry updated with BAA status
- [ ] Privacy Officer approval documented

## Business Associate Termination Checklist

- [ ] PHI return or destruction confirmed
- [ ] Destruction certificate obtained (if applicable)
- [ ] Continuing protections documented (if infeasible)
- [ ] System access revoked
- [ ] Vendor registry updated
- [ ] Termination documented
