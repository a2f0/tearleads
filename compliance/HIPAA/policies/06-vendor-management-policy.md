# Vendor Management Policy (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-001 | policy=compliance/HIPAA/policies/04-vendor-management-policy.md | procedure=compliance/HIPAA/procedures/04-vendor-management-procedure.md | control=vendor-inventory -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-011 | policy=compliance/HIPAA/policies/04-vendor-management-policy.md | procedure=compliance/HIPAA/procedures/04-vendor-management-procedure.md | control=vendor-risk-assessment -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-012 | policy=compliance/HIPAA/policies/04-vendor-management-policy.md | procedure=compliance/HIPAA/procedures/04-vendor-management-procedure.md | control=vendor-due-diligence -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-013 | policy=compliance/HIPAA/policies/04-vendor-management-policy.md | procedure=compliance/HIPAA/procedures/04-vendor-management-procedure.md | control=vendor-monitoring -->

## Purpose

Define mandatory controls for Business Associate management, ensuring all third-party vendors with potential access to Protected Health Information (PHI) comply with HIPAA Security Rule requirements.

## Scope

1. Business Associate identification and inventory.
2. Business Associate Agreement (BAA) requirements.
3. Vendor risk assessment for PHI access.
4. Ongoing Business Associate monitoring.
5. Breach notification coordination.

## Policy Control Index

1. `VENDOR-01` Business Associate inventory (`TL-VENDOR-001`).
2. `VENDOR-02` PHI access risk assessment (`TL-VENDOR-011`).
3. `VENDOR-03` BAA and due diligence requirements (`TL-VENDOR-012`).
4. `VENDOR-04` Ongoing Business Associate monitoring (`TL-VENDOR-013`).
5. `VENDOR-05` Subcontractor requirements.
6. `VENDOR-06` Breach notification procedures.
7. `VENDOR-07` Business Associate termination.

## Roles and Responsibilities

1. Privacy Officer maintains this policy and oversees BAA compliance.
2. Security Officer ensures Business Associates meet security requirements.
3. Compliance Officer tracks BAA execution and renewals.
4. Legal Counsel reviews and approves BAA terms.

## Policy Statements

### Business Associate Inventory (`VENDOR-01`, `TL-VENDOR-001`) - 164.308(b)(1)

1. All Business Associates must be documented in the [Vendor Registry](../../vendor-registry.md).
2. Vendors must be classified by PHI access level: direct access, potential access, no access.
3. The Business Associate inventory must be reviewed annually.

### PHI Access Risk Assessment (`VENDOR-02`, `TL-VENDOR-011`) - 164.308(a)(1)(ii)(A)

1. Risk assessment must be performed before granting any vendor PHI access.
2. Assessment must evaluate: PHI types accessed, access methods, security controls, and breach risk.
3. Vendors with direct PHI access are classified as Business Associates.

### BAA Requirements (`VENDOR-03`, `TL-VENDOR-012`) - 164.308(b)(3), 164.314(a)

1. All Business Associates must execute a BAA before PHI access is granted.
2. BAAs must include required HIPAA provisions:
   - Permitted uses and disclosures
   - Safeguards requirements
   - Reporting obligations
   - Subcontractor requirements
   - Termination provisions
3. BAAs must be reviewed and updated upon material changes.

### Business Associate Monitoring (`VENDOR-04`, `TL-VENDOR-013`) - 164.308(a)(8)

1. Business Associate compliance must be evaluated periodically.
2. Security incidents involving Business Associates must be documented.
3. Material changes in Business Associate security posture require re-assessment.

### Subcontractor Requirements (`VENDOR-05`) - 164.314(a)(2)(i)

1. Business Associates must flow down HIPAA requirements to subcontractors.
2. Subcontractor BAAs must be required and verified.

### Breach Notification (`VENDOR-06`) - 164.410

1. Business Associates must notify of breaches within 60 days.
2. Breach notifications must include required elements per HIPAA Breach Notification Rule.
3. Covered entity must coordinate notification to affected individuals and HHS.

### Business Associate Termination (`VENDOR-07`) - 164.314(a)(2)(ii)

1. Upon termination, Business Associates must return or destroy all PHI.
2. If return/destruction is infeasible, BAA protections continue.
3. Termination must be documented in vendor registry.

## Framework Mapping

| Sentinel | HIPAA Standard | Control Outcome |
| --- | --- | --- |
| `TL-VENDOR-001` | 164.308(b)(1) | Business Associates identified and documented. |
| `TL-VENDOR-011` | 164.308(a)(1)(ii)(A) | Risk assessment for PHI access. |
| `TL-VENDOR-012` | 164.308(b)(3), 164.314(a) | BAA executed with required provisions. |
| `TL-VENDOR-013` | 164.308(a)(8) | Ongoing Business Associate evaluation. |

## PHI Access Classification

| Classification | Description | Requirements |
| --- | --- | --- |
| Direct Access | Vendor processes, stores, or transmits PHI | BAA required, full security assessment |
| Potential Access | Vendor may incidentally access PHI | BAA recommended, risk assessment |
| No Access | Vendor has no PHI access | No BAA required |

## Current Business Associate Status

Based on current architecture, no vendors have direct PHI access. If PHI processing is introduced, the following vendors would require BAAs:

| Vendor | Current PHI Access | BAA Status |
| --- | --- | --- |
| Hetzner Cloud | No | N/A |
| Microsoft Azure | No | BAA available if needed |
| Let's Encrypt | No | N/A (no data processing) |
| GitHub | No | Enterprise BAA available |
| RevenueCat | No | N/A |
| OpenRouter | No | N/A |
| Anthropic | No | N/A |
| OpenAI | No | N/A |
| Google | No | Cloud DPA available |

## Exceptions

Policy exceptions require Privacy Officer approval, documented risk acceptance, and compensating controls.
