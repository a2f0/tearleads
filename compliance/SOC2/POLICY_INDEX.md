# SOC 2 Policy Index

This index catalogs the SOC 2 Trust Services Criteria for agent-based compliance demonstration.

## Regulatory Authority

- **Governing Body**: American Institute of Certified Public Accountants (AICPA)
- **Framework**: Trust Services Criteria (TSC)
- **Current Version**: 2017 Trust Services Criteria (with Revised Points of Focus - 2022)
- **Foundation**: Based on COSO Internal Control Framework

## Official Sources

- [AICPA SOC 2 Overview](https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2)
- [2017 Trust Services Criteria (Revised 2022)](https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022)
- [SOC 2 Description Criteria](https://www.aicpa-cima.com/resources/download/get-description-criteria-for-your-organizations-soc-2-r-report)

---

## Report Types

- **SOC 2 Type I**: Point-in-time assessment of control design (single date)
- **SOC 2 Type II**: Assessment of control design and operating effectiveness (minimum 6 months)

---

## Trust Services Categories

SOC 2 reports may include one or more of the following categories:

- **Security (CC)**: Protection against unauthorized access - REQUIRED
- **Availability (A)**: Accessibility of systems as committed - Optional
- **Processing Integrity (PI)**: Complete, accurate, timely processing - Optional
- **Confidentiality (C)**: Protection of confidential information - Optional
- **Privacy (P)**: Personal information handling per privacy notice - Optional

---

## Security Category - Common Criteria (CC1-CC9)

The Security category is mandatory for all SOC 2 reports and contains 9 Common Criteria series.

### CC1: Control Environment

Establishes the organizational framework for security controls.

- **CC1.1**: COSO Principle 1 - Demonstrates commitment to integrity and ethical values
- **CC1.2**: COSO Principle 2 - Board exercises oversight responsibility
- **CC1.3**: COSO Principle 3 - Management establishes structures, reporting lines, authorities
- **CC1.4**: COSO Principle 4 - Demonstrates commitment to attract, develop, retain competent individuals
- **CC1.5**: COSO Principle 5 - Holds individuals accountable for internal control responsibilities

### CC2: Communication and Information

Ensures policies and procedures are communicated effectively.

- **CC2.1**: COSO Principle 13 - Obtains/generates and uses relevant, quality information
- **CC2.2**: COSO Principle 14 - Internally communicates information, including objectives
- **CC2.3**: COSO Principle 15 - Communicates with external parties regarding matters affecting functioning

### CC3: Risk Assessment

Identifies and manages risks to system and data security.

- **CC3.1**: COSO Principle 6 - Specifies objectives with sufficient clarity
- **CC3.2**: COSO Principle 7 - Identifies and analyzes risks to achievement of objectives
- **CC3.3**: COSO Principle 8 - Considers potential for fraud in assessing risks
- **CC3.4**: COSO Principle 9 - Identifies and assesses changes that could impact internal controls

### CC4: Monitoring of Controls

Ensures ongoing evaluation and remediation of control effectiveness.

- **CC4.1**: COSO Principle 16 - Selects, develops, performs ongoing/separate evaluations
- **CC4.2**: COSO Principle 17 - Evaluates and communicates internal control deficiencies

### CC5: Control Activities

Implements controls to achieve objectives and address risks.

- **CC5.1**: COSO Principle 10 - Selects and develops control activities contributing to risk mitigation
- **CC5.2**: COSO Principle 11 - Selects and develops general controls over technology
- **CC5.3**: COSO Principle 12 - Deploys control activities through policies and procedures

### CC6: Logical and Physical Access Controls

Restricts access to systems and data.

- **CC6.1**: Implements logical access security software, infrastructure, architectures
- **CC6.2**: Registers/authorizes users prior to issuing credentials; removes access when no longer authorized
- **CC6.3**: Authorizes, modifies, removes access based on roles, responsibilities, segregation of duties
- **CC6.4**: Restricts physical access to facilities and protected information assets
- **CC6.5**: Disposes of, destroys, sanitizes assets to prevent unauthorized access
- **CC6.6**: Implements logical access controls to protect against threats from outside system boundaries
- **CC6.7**: Restricts transmission, movement, removal of information to authorized parties
- **CC6.8**: Implements controls to prevent/detect unauthorized/malicious software

### CC7: System Operations

Ensures systems function securely during daily operations.

- **CC7.1**: Detects and monitors security events and configuration changes introducing vulnerabilities
- **CC7.2**: Monitors system components for anomalies indicative of malicious acts, natural disasters, errors
- **CC7.3**: Evaluates security events to determine whether failures or incidents
- **CC7.4**: Responds to identified security incidents through defined response process
- **CC7.5**: Identifies, develops, implements activities to recover from identified incidents

### CC8: Change Management

Controls changes to system infrastructure and software.

- **CC8.1**: Authorizes, designs, develops/acquires, configures, documents, tests, approves, implements changes

### CC9: Risk Mitigation

Addresses business disruption risks and vendor management.

- **CC9.1**: Identifies and mitigates risks related to business disruption
- **CC9.2**: Assesses and manages risks associated with vendors and business partners

---

## Availability Category (A Series)

Ensures systems are available for operation as committed.

- **A1.1**: Maintains, monitors, evaluates current processing capacity and use
- **A1.2**: Authorizes, designs, develops, implements activities to maintain availability and recover
- **A1.3**: Tests recovery plan procedures supporting system recovery objectives

---

## Processing Integrity Category (PI Series)

Ensures system processing is complete, valid, accurate, timely, and authorized.

- **PI1.1**: Obtains/generates, uses relevant quality information for processing activities
- **PI1.2**: Implements policies/procedures over system inputs, including accuracy and completeness
- **PI1.3**: Implements policies/procedures over system processing ensuring accuracy and completeness
- **PI1.4**: Implements policies/procedures to validate processing outputs are complete and accurate
- **PI1.5**: Implements policies/procedures for output storage, distribution, retention

---

## Confidentiality Category (C Series)

Protects information designated as confidential.

- **C1.1**: Identifies and maintains confidential information to meet entity objectives
- **C1.2**: Disposes of confidential information to meet entity objectives

---

## Privacy Category (P Series)

Governs collection, use, retention, disclosure, and disposal of personal information.

- **P1.1**: Provides notice about privacy practices regarding collection, use, retention, disclosure, disposal
- **P2.1**: Communicates choices available regarding collection, use, retention, disclosure, disposal
- **P3.1**: Collects personal information consistent with privacy objectives
- **P3.2**: For information collected from third parties, entity confirms third parties are reliable
- **P4.1**: Limits use of personal information to purposes identified in privacy notice
- **P4.2**: Retains personal information consistent with privacy objectives
- **P4.3**: Disposes of personal information to meet privacy objectives
- **P5.1**: Grants identified/authenticated data subjects access to their personal information
- **P5.2**: Corrects, amends, appends personal information based on data subject requests
- **P6.1**: Discloses personal information to third parties only for identified purposes
- **P6.2**: Creates and retains complete, accurate, timely records of authorized disclosures
- **P6.3**: Creates and retains records of detected/reported unauthorized disclosures
- **P6.4**: Obtains privacy commitments from vendors and monitors compliance
- **P6.5**: Obtains commitments from third parties with access to personal information
- **P6.6**: Provides notification of breaches and incidents to affected data subjects
- **P6.7**: Provides information about breaches/incidents to regulators
- **P7.1**: Collects and maintains accurate, complete, relevant personal information
- **P8.1**: Implements processes for data subjects to file complaints or inquiries

---

## Points of Focus

Points of focus provide guidance for each criterion but are not prescriptive requirements. Key areas include:

- **Technology Controls**: Firewalls, encryption, access management systems
- **Operational Procedures**: Change management processes, incident response
- **Vendor Management**: Third-party risk assessments, contractual requirements
- **Data Protection**: Classification, encryption at rest and in transit
- **Monitoring**: Security event logging, anomaly detection, alerting

---

## Implemented Policy/Procedure Set

### Policies

1. [P-01 Account Management Policy](./policies/01-account-management-policy.md)
2. [P-02 Audit Logging Policy](./policies/02-audit-logging-policy.md)
3. [P-03 Payment Infrastructure Policy](./policies/03-payment-infrastructure-policy.md)
4. [P-04 Infrastructure Security Policy](./policies/04-infrastructure-security-policy.md)
5. [P-05 End-to-End Encryption Policy](./policies/05-end-to-end-encryption-policy.md)
6. [P-06 Vendor Management Policy](./policies/06-vendor-management-policy.md)

### Procedures

1. [PR-01 Account Management Procedure](./procedures/01-account-management-procedure.md)
2. [PR-02 Audit Logging Procedure](./procedures/02-audit-logging-procedure.md)
3. [PR-03 Payment Infrastructure Procedure](./procedures/03-payment-infrastructure-procedure.md)
4. [PR-04 Infrastructure Security Procedure](./procedures/04-infrastructure-security-procedure.md)
5. [PR-05 End-to-End Encryption Procedure](./procedures/05-end-to-end-encryption-procedure.md)
6. [PR-06 Vendor Management Procedure](./procedures/06-vendor-management-procedure.md)

### Technical Control Maps

1. [TC-01 Account Management Technical Control Map](./technical-controls/01-account-management-control-map.md)
2. [TC-02 Audit Logging Technical Control Map](./technical-controls/02-audit-logging-control-map.md)
3. [TC-03 Payment Infrastructure Technical Control Map](./technical-controls/03-payment-infrastructure-control-map.md)
4. [TC-04 Infrastructure Security Technical Control Map](./technical-controls/04-infrastructure-security-control-map.md)
5. [TC-05 End-to-End Encryption Technical Control Map](./technical-controls/05-end-to-end-encryption-control-map.md)
6. [TC-06 Vendor Management Technical Control Map](./technical-controls/06-vendor-management-control-map.md)
7. [TC-07 Disaster Recovery Technical Control Map](./technical-controls/07-disaster-recovery-control-map.md)

---

## Agent Compliance Skills Mapping

- **Access Control**: CC6.1, CC6.2, CC6.3, CC6.6
- **Audit Logging**: CC7.1, CC7.2, CC4.1
- **Change Management**: CC8.1
- **Incident Response**: CC7.3, CC7.4, CC7.5
- **Risk Assessment**: CC3.1, CC3.2, CC3.3, CC3.4
- **Training/Awareness**: CC1.4, CC2.2
- **Vendor Management**: CC9.2, P6.4, P6.5
- **Data Backup/Recovery**: A1.2, A1.3, CC9.1
- **Container Registry**: CC6.1, CC6.2, CC6.5, CC7.1 (ECR, scan-on-push, lifecycle, authentication)
- **Disaster Recovery**: CC9.1, A1.2, A1.3 (state isolation, locking, recovery procedures)
- **Data Protection**: CC6.5, CC6.7, C1.1, C1.2
- **Malware Protection**: CC6.8
- **Physical Security**: CC6.4
- **Payment Infrastructure**: CC6.1, CC6.6, CC6.7, CC7.1, CC7.2, PI1.2, PI1.3, PI1.4
- **Infrastructure Security**: CC6.1, CC6.6, CC6.7 (SSH hardening, firewalls, kernel hardening, service isolation)
- **End-to-End Encryption**: CC6.1, CC6.7, C1.1, PI1.1 (MLS RFC 9420, ChaCha20-Poly1305, X25519, Ed25519, forward secrecy, zero-knowledge service)

---

## Examination Considerations

- **Management Assertion**: Management provides written assertion about system description and controls
- **Auditor Report**: CPA provides opinion on fairness of description and control effectiveness
- **System Description**: Detailed description of services, infrastructure, software, data, policies
- **Test of Controls**: Auditor tests operating effectiveness over examination period (Type II)
- **Complementary Controls**: User entity controls required to achieve control objectives
