# Vendor Management Policy (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-001 | policy=compliance/SOC2/policies/04-vendor-management-policy.md | procedure=compliance/SOC2/procedures/04-vendor-management-procedure.md | control=vendor-inventory -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-011 | policy=compliance/SOC2/policies/04-vendor-management-policy.md | procedure=compliance/SOC2/procedures/04-vendor-management-procedure.md | control=vendor-risk-assessment -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-012 | policy=compliance/SOC2/policies/04-vendor-management-policy.md | procedure=compliance/SOC2/procedures/04-vendor-management-procedure.md | control=vendor-due-diligence -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-013 | policy=compliance/SOC2/policies/04-vendor-management-policy.md | procedure=compliance/SOC2/procedures/04-vendor-management-procedure.md | control=vendor-monitoring -->

## Purpose

Define mandatory controls for third-party vendor management, risk assessment, and ongoing monitoring. This policy ensures that vendors processing Tearleads data or providing critical services meet security and compliance requirements aligned with SOC 2 Trust Services Criteria.

## Scope

1. Vendor inventory and classification.
2. Vendor due diligence and onboarding.
3. Vendor risk assessment and categorization.
4. Ongoing vendor monitoring and review.
5. Vendor offboarding and data return/destruction.

## Policy Control Index

1. `VENDOR-01` Vendor inventory maintenance (`TL-VENDOR-001`).
2. `VENDOR-02` Vendor risk assessment before onboarding (`TL-VENDOR-011`).
3. `VENDOR-03` Due diligence documentation requirements (`TL-VENDOR-012`).
4. `VENDOR-04` Ongoing vendor monitoring (`TL-VENDOR-013`).
5. `VENDOR-05` Data processing agreement requirements.
6. `VENDOR-06` Vendor incident notification requirements.
7. `VENDOR-07` Vendor offboarding procedures.

## Roles and Responsibilities

1. Security Owner maintains this policy, approves vendor onboarding, and reviews risk assessments.
2. Engineering leads evaluate technical integrations and security configurations.
3. Operations monitors vendor SLAs and service availability.
4. Compliance owners retain evidence artifacts and track vendor certifications.

## Policy Statements

### Vendor Inventory (`VENDOR-01`, `TL-VENDOR-001`)

1. All third-party vendors with access to Tearleads data or providing critical services must be documented in the [Vendor Registry](../vendor-registry.md).
2. The vendor registry must include: legal entity, services provided, data classification, compliance certifications, and contract type.
3. The vendor registry must be reviewed quarterly and updated within 30 days of vendor changes.

### Risk Assessment (`VENDOR-02`, `TL-VENDOR-011`)

1. All vendors must undergo risk assessment before onboarding.
2. Risk assessment must evaluate: data sensitivity, business criticality, replaceability, and vendor security posture.
3. Vendors are categorized into tiers based on risk level:
   - **Tier 1 (Critical)**: Infrastructure vendors, >99.9% uptime required
   - **Tier 2 (Business Critical)**: Platform services, business continuity impact
   - **Tier 3 (Development)**: Development tools, limited data access

### Due Diligence (`VENDOR-03`, `TL-VENDOR-012`)

1. Tier 1 and Tier 2 vendors must provide evidence of SOC 2 Type II certification or equivalent.
2. Vendors processing personal data must execute a Data Processing Agreement (DPA).
3. Vendor security questionnaires must be completed for Tier 1 vendors.
4. Due diligence documentation must be retained for the vendor relationship duration plus 3 years.

### Ongoing Monitoring (`VENDOR-04`, `TL-VENDOR-013`)

1. Vendor certifications must be verified annually.
2. Vendor security incidents affecting Tearleads must be tracked and documented.
3. Vendor service level metrics must be monitored for Tier 1 vendors.
4. Material changes in vendor security posture require re-assessment.

### Data Processing Agreements (`VENDOR-05`)

1. Vendors processing customer data must have a DPA in place.
2. DPAs must include: data handling requirements, security obligations, breach notification timelines, and data return/destruction provisions.

### Incident Notification (`VENDOR-06`)

1. Vendors must notify Tearleads of security incidents within 72 hours.
2. Vendor incident responses must be documented and tracked to resolution.

### Vendor Offboarding (`VENDOR-07`)

1. Vendor offboarding must include data return or certified destruction.
2. Access credentials must be revoked upon contract termination.
3. Offboarding must be documented in the vendor registry.

## Framework Mapping

| Sentinel | SOC2 TSC | Control Outcome |
| --- | --- | --- |
| `TL-VENDOR-001` | CC9.2 | Vendor inventory maintained and reviewed quarterly. |
| `TL-VENDOR-011` | CC3.2, CC9.2 | Vendor risks identified and assessed before onboarding. |
| `TL-VENDOR-012` | CC9.2 | Due diligence performed with documented evidence. |
| `TL-VENDOR-013` | CC4.1, CC9.2 | Ongoing vendor monitoring with certification verification. |

## Vendor Risk Matrix

| Data Classification | Business Criticality | Minimum Requirements |
| --- | --- | --- |
| High | Critical | SOC 2 Type II, DPA, annual review |
| High | Non-critical | SOC 2 Type II or equivalent, DPA |
| Medium | Critical | SOC 2 or ISO 27001, DPA if PII |
| Medium | Non-critical | Security questionnaire, DPA if PII |
| Low | Any | Terms of service review |

## Exceptions

Policy exceptions require written Security Owner approval, defined compensating controls, and an expiration date not to exceed 90 days.
