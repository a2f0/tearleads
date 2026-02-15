# Vendor Management Policy (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-001 | policy=compliance/NIST.SP.800-53/policies/04-vendor-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-vendor-management-procedure.md | control=vendor-inventory -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-011 | policy=compliance/NIST.SP.800-53/policies/04-vendor-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-vendor-management-procedure.md | control=vendor-risk-assessment -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-012 | policy=compliance/NIST.SP.800-53/policies/04-vendor-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-vendor-management-procedure.md | control=vendor-due-diligence -->
<!-- COMPLIANCE_SENTINEL: TL-VENDOR-013 | policy=compliance/NIST.SP.800-53/policies/04-vendor-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/04-vendor-management-procedure.md | control=vendor-monitoring -->

## Purpose

Define mandatory controls for external information system services, supply chain risk management, and third-party vendor oversight in accordance with NIST SP 800-53 requirements.

## Scope

1. External information system services (SA-9).
2. Supply chain risk management (SR family).
3. Third-party personnel security (PS-7).
4. External system connections (CA-3).

## Policy Control Index

1. `VENDOR-01` External system services inventory (`TL-VENDOR-001`).
2. `VENDOR-02` Supply chain risk assessment (`TL-VENDOR-011`).
3. `VENDOR-03` Acquisition process controls (`TL-VENDOR-012`).
4. `VENDOR-04` Continuous monitoring of external services (`TL-VENDOR-013`).
5. `VENDOR-05` Information exchange agreements.
6. `VENDOR-06` Incident reporting requirements.
7. `VENDOR-07` Service termination procedures.

## Roles and Responsibilities

1. Security Owner maintains this policy and approves external service agreements.
2. System Owner ensures external services meet security requirements.
3. Contracting Officer manages acquisition documentation.
4. ISSO monitors external service security posture.

## Policy Statements

### External System Services (`VENDOR-01`, `TL-VENDOR-001`) - SA-9

1. All external information system services must be documented in the [Vendor Registry](../../vendor-registry.md).
2. External service providers must implement security controls commensurate with organizational requirements.
3. User roles and responsibilities for external services must be defined.

### Supply Chain Risk Assessment (`VENDOR-02`, `TL-VENDOR-011`) - SR-3, SR-5

1. Supply chain risks must be assessed for all external services.
2. Risk assessment must consider: confidentiality, integrity, availability, and authenticity.
3. Suppliers must be assessed for security capability and trustworthiness.

### Acquisition Controls (`VENDOR-03`, `TL-VENDOR-012`) - SA-4, SA-12

1. Acquisition documents must include security requirements.
2. Component authenticity must be verified for critical systems.
3. Developer security testing evidence must be required for critical software.

### Continuous Monitoring (`VENDOR-04`, `TL-VENDOR-013`) - CA-7, SA-9(2)

1. External service security posture must be monitored continuously.
2. Changes in external service provider security must be assessed.
3. External service audit records must be reviewed.

### Information Exchange Agreements (`VENDOR-05`) - CA-3

1. Interconnection security agreements must be established for system connections.
2. Agreements must specify security controls, incident reporting, and termination procedures.

### Incident Reporting (`VENDOR-06`) - IR-6

1. External service providers must report security incidents promptly.
2. Incident reports must include scope, impact, and remediation actions.

### Service Termination (`VENDOR-07`) - SA-9(5)

1. Procedures for service termination must include data transfer or destruction.
2. Access credentials must be revoked upon termination.

## Framework Mapping

| Sentinel | NIST Control | Control Outcome |
| --- | --- | --- |
| `TL-VENDOR-001` | SA-9, PM-30 | External services documented and monitored. |
| `TL-VENDOR-011` | SR-3, SR-5, RA-3 | Supply chain risks assessed for external services. |
| `TL-VENDOR-012` | SA-4, SA-12 | Acquisition process includes security requirements. |
| `TL-VENDOR-013` | CA-7, SA-9(2) | Continuous monitoring of external service security. |

## NIST Control Family References

- **SA (System and Services Acquisition)**: SA-4, SA-9, SA-12
- **SR (Supply Chain Risk Management)**: SR-3, SR-5, SR-6
- **CA (Assessment, Authorization, and Monitoring)**: CA-3, CA-7
- **PS (Personnel Security)**: PS-7
- **PM (Program Management)**: PM-30

## Exceptions

Policy exceptions require ISSO approval, defined compensating controls, and Plan of Action and Milestones (POA&M) documentation.
