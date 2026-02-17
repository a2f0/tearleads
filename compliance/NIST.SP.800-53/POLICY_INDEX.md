# NIST SP 800-53 Policy Index

This index catalogs the NIST Special Publication 800-53 Revision 5 security and privacy controls for agent-based compliance demonstration.

## Regulatory Authority

- **Governing Body**: National Institute of Standards and Technology (NIST)
- **Publication**: Special Publication 800-53, Revision 5
- **Title**: Security and Privacy Controls for Information Systems and Organizations
- **Current Version**: Rev. 5, Update 1 (December 10, 2020)
- **Total Controls**: 1,189 individual controls across 20 control families

## Official Sources

- [NIST SP 800-53 Rev. 5 (Primary)](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)
- [Full Publication PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf)
- [SP 800-53A Rev. 5 (Assessment Procedures)](https://csrc.nist.gov/pubs/sp/800/53/a/r5/final)
- [OSCAL Control Formats (JSON/XML/YAML)](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

---

## Control Baselines

- **Low**: 149 controls - Minimal security needs
- **Moderate**: 287 controls - Substantial risk factors
- **High**: 370 controls - Most critical/sensitive systems

---

## Control Families

The full control family catalog has been moved to keep this index within repository file-size guardrails.

- See [NIST SP 800-53 Control Families](./POLICY_INDEX_CONTROL_FAMILIES.md) for detailed AC/AT/AU/CA/.../SR control listings.

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
8. [TC-08 Database Security Technical Control Map](./technical-controls/08-database-security-control-map.md)

---

## Agent Compliance Skills Mapping

- **Access Control**: AC, IA, PE
- **Audit Logging**: AU, SI-4
- **Configuration Management**: CM, SA-10
- **Incident Response**: IR, SI-4, SI-5
- **Risk Assessment**: RA, PM-9
- **Training/Awareness**: AT, PM-13
- **Vendor Management**: SA-9, SR
- **Data Backup/Recovery**: CP-9, CP-10
- **Data Protection**: SC-8, SC-13, SC-28, MP
- **Malware Protection**: SI-3, SI-8
- **Physical Security**: PE
- **Privacy**: PT
- **Vulnerability Management**: RA-5, SI-2
- **Payment Infrastructure**: SC-8, SC-13, SC-23, SI-7, SI-10, AU-2, AU-3, AU-10, AU-11, AU-12, AC-2, AC-3, AC-6
- **Infrastructure Security**: AC-6, AC-7, AC-17, IA-2, IA-5, SC-5, SC-7, SC-12, SI-16 (SSH hardening, firewalls, kernel hardening, service isolation)
- **End-to-End Encryption**: SC-8, SC-8(1), SC-12, SC-13, SC-28, IA-5, SI-7 (MLS RFC 9420, ChaCha20-Poly1305, X25519, Ed25519, forward secrecy)

---

## Framework Crosswalks

NIST provides mappings between SP 800-53 and other frameworks:

- **NIST Cybersecurity Framework**: Yes
- **NIST Privacy Framework**: Yes
- **ISO/IEC 27001:2022**: Yes
- **FedRAMP**: Based on 800-53
- **CMMC**: Derived from 800-171 (subset of 800-53)
