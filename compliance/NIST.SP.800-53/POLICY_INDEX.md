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

NIST SP 800-53 Rev. 5 contains 20 control families, expanded from 18 in Rev. 4 with the addition of PT (PII Processing) and SR (Supply Chain Risk Management).

### AC - Access Control

Governs mechanisms to permit or deny access to information and systems.

- **AC-1**: Policy and Procedures - Develop and disseminate access control policy
- **AC-2**: Account Management - Manage system accounts, credentials, identifiers
- **AC-3**: Access Enforcement - Enforce approved authorizations for logical access
- **AC-4**: Information Flow Enforcement - Control information flow within and between systems
- **AC-5**: Separation of Duties - Separate duties of individuals to prevent malicious activity
- **AC-6**: Least Privilege - Employ principle of least privilege
- **AC-7**: Unsuccessful Logon Attempts - Limit consecutive invalid logon attempts
- **AC-8**: System Use Notification - Display system use notification before granting access
- **AC-11**: Device Lock - Lock device after period of inactivity
- **AC-12**: Session Termination - Terminate session after conditions are met
- **AC-14**: Permitted Actions Without Identification - Identify actions permitted without authentication
- **AC-17**: Remote Access - Authorize, monitor, control remote access
- **AC-18**: Wireless Access - Authorize, monitor, control wireless access
- **AC-19**: Access Control for Mobile Devices - Restrict which mobile devices can connect
- **AC-20**: Use of External Systems - Establish terms for use of external systems
- **AC-21**: Information Sharing - Facilitate authorized information sharing
- **AC-22**: Publicly Accessible Content - Control information posted on public systems

### AT - Awareness and Training

Ensures personnel have security awareness and training.

- **AT-1**: Policy and Procedures - Develop security awareness and training policy
- **AT-2**: Literacy Training and Awareness - Provide basic security awareness training
- **AT-3**: Role-Based Training - Provide role-based security training
- **AT-4**: Training Records - Document and monitor training activities

### AU - Audit and Accountability

Records system events and traces actions to individuals.

- **AU-1**: Policy and Procedures - Develop audit and accountability policy
- **AU-2**: Event Logging - Identify events requiring logging
- **AU-3**: Content of Audit Records - Include required information in audit records
- **AU-4**: Audit Log Storage Capacity - Allocate audit log storage capacity
- **AU-5**: Response to Audit Logging Process Failures - Alert on audit failure; take defined actions
- **AU-6**: Audit Record Review, Analysis, and Reporting - Review and analyze system audit records
- **AU-7**: Audit Record Reduction and Report Generation - Provide audit reduction and report generation
- **AU-8**: Time Stamps - Use internal clocks to generate time stamps
- **AU-9**: Protection of Audit Information - Protect audit information from unauthorized access
- **AU-10**: Non-repudiation - Provide irrefutable evidence of actions
- **AU-11**: Audit Record Retention - Retain audit records per retention requirements
- **AU-12**: Audit Record Generation - Provide audit record generation capability

### CA - Assessment, Authorization, and Monitoring

Covers security assessments, authorizations, and continuous monitoring.

- **CA-1**: Policy and Procedures - Develop security assessment policy
- **CA-2**: Control Assessments - Assess security controls in system
- **CA-3**: Information Exchange - Approve and manage system interconnections
- **CA-5**: Plan of Action and Milestones - Develop and update POA&M
- **CA-6**: Authorization - Authorize system operation
- **CA-7**: Continuous Monitoring - Develop continuous monitoring strategy
- **CA-8**: Penetration Testing - Conduct penetration testing
- **CA-9**: Internal System Connections - Authorize internal system connections

### CM - Configuration Management

Establishes baseline configurations and manages changes.

- **CM-1**: Policy and Procedures - Develop configuration management policy
- **CM-2**: Baseline Configuration - Develop and maintain baseline configuration
- **CM-3**: Configuration Change Control - Control changes to system
- **CM-4**: Impact Analyses - Analyze changes for security impact
- **CM-5**: Access Restrictions for Change - Define, document, approve physical/logical access for changes
- **CM-6**: Configuration Settings - Establish and enforce configuration settings
- **CM-7**: Least Functionality - Configure system to provide only essential capabilities
- **CM-8**: System Component Inventory - Develop and maintain inventory of system components
- **CM-9**: Configuration Management Plan - Develop and implement configuration management plan
- **CM-10**: Software Usage Restrictions - Use software in accordance with agreements
- **CM-11**: User-Installed Software - Control user-installed software

### CP - Contingency Planning

Prepares for and responds to system disruptions.

- **CP-1**: Policy and Procedures - Develop contingency planning policy
- **CP-2**: Contingency Plan - Develop and implement contingency plan
- **CP-3**: Contingency Training - Provide contingency training
- **CP-4**: Contingency Plan Testing - Test contingency plan
- **CP-6**: Alternate Storage Site - Establish alternate storage site
- **CP-7**: Alternate Processing Site - Establish alternate processing site
- **CP-8**: Telecommunications Services - Establish alternate telecommunications services
- **CP-9**: System Backup - Conduct system backups
- **CP-10**: System Recovery and Reconstitution - Recover and reconstitute system

### IA - Identification and Authentication

Verifies identity of users and devices.

- **IA-1**: Policy and Procedures - Develop identification and authentication policy
- **IA-2**: Identification and Authentication (Organizational Users) - Uniquely identify and authenticate users
- **IA-3**: Device Identification and Authentication - Identify and authenticate devices
- **IA-4**: Identifier Management - Manage system identifiers
- **IA-5**: Authenticator Management - Manage authenticators (passwords, tokens, etc.)
- **IA-6**: Authentication Feedback - Obscure feedback of authentication information
- **IA-7**: Cryptographic Module Authentication - Use FIPS-validated cryptographic modules
- **IA-8**: Identification and Authentication (Non-Organizational Users) - Identify/authenticate non-org users
- **IA-11**: Re-authentication - Require re-authentication under defined conditions
- **IA-12**: Identity Proofing - Identity proof users requiring accounts

### IR - Incident Response

Detects, responds to, and recovers from security incidents.

- **IR-1**: Policy and Procedures - Develop incident response policy
- **IR-2**: Incident Response Training - Provide incident response training
- **IR-3**: Incident Response Testing - Test incident response capability
- **IR-4**: Incident Handling - Implement incident handling capability
- **IR-5**: Incident Monitoring - Track and document incidents
- **IR-6**: Incident Reporting - Report incidents to appropriate authorities
- **IR-7**: Incident Response Assistance - Provide incident response support resources
- **IR-8**: Incident Response Plan - Develop incident response plan

### MA - Maintenance

Controls maintenance of organizational systems.

- **MA-1**: Policy and Procedures - Develop maintenance policy
- **MA-2**: Controlled Maintenance - Schedule and perform maintenance
- **MA-3**: Maintenance Tools - Approve and control maintenance tools
- **MA-4**: Nonlocal Maintenance - Authorize and monitor nonlocal maintenance
- **MA-5**: Maintenance Personnel - Establish process for maintenance personnel authorization
- **MA-6**: Timely Maintenance - Obtain timely maintenance support

### MP - Media Protection

Protects system media containing sensitive information.

- **MP-1**: Policy and Procedures - Develop media protection policy
- **MP-2**: Media Access - Restrict access to system media
- **MP-3**: Media Marking - Mark media with required markings
- **MP-4**: Media Storage - Store media in controlled areas
- **MP-5**: Media Transport - Protect media during transport
- **MP-6**: Media Sanitization - Sanitize media before disposal or reuse
- **MP-7**: Media Use - Restrict use of media types

### PE - Physical and Environmental Protection

Protects systems from physical and environmental threats.

- **PE-1**: Policy and Procedures - Develop physical and environmental protection policy
- **PE-2**: Physical Access Authorizations - Develop and maintain physical access authorizations
- **PE-3**: Physical Access Control - Enforce physical access authorizations
- **PE-4**: Access Control for Transmission - Control physical access to transmission medium
- **PE-5**: Access Control for Output Devices - Control physical access to output devices
- **PE-6**: Monitoring Physical Access - Monitor physical access
- **PE-8**: Visitor Access Records - Maintain visitor access records
- **PE-9**: Power Equipment and Cabling - Protect power equipment and cabling
- **PE-10**: Emergency Shutoff - Provide emergency shutoff capability
- **PE-11**: Emergency Power - Provide emergency power capability
- **PE-12**: Emergency Lighting - Employ emergency lighting
- **PE-13**: Fire Protection - Employ fire detection and suppression
- **PE-14**: Environmental Controls - Maintain temperature and humidity
- **PE-15**: Water Damage Protection - Protect from water damage
- **PE-16**: Delivery and Removal - Control delivery and removal of equipment
- **PE-17**: Alternate Work Site - Employ controls at alternate work sites

### PL - Planning

Addresses security planning and privacy program requirements.

- **PL-1**: Policy and Procedures - Develop planning policy
- **PL-2**: System Security and Privacy Plans - Develop and maintain SSP
- **PL-4**: Rules of Behavior - Establish rules of behavior
- **PL-8**: Security and Privacy Architectures - Develop architectures
- **PL-10**: Baseline Selection - Select security control baseline
- **PL-11**: Baseline Tailoring - Tailor baseline to system environment

### PM - Program Management

Establishes organization-wide security program.

- **PM-1**: Information Security Program Plan - Develop organization-wide information security program
- **PM-2**: Information Security Program Leadership Role - Appoint senior security official
- **PM-3**: Information Security and Privacy Resources - Ensure resources for security program
- **PM-4**: Plan of Action and Milestones Process - Implement POA&M process
- **PM-5**: System Inventory - Maintain inventory of systems
- **PM-6**: Measures of Performance - Develop and monitor security metrics
- **PM-7**: Enterprise Architecture - Develop and maintain enterprise architecture
- **PM-8**: Critical Infrastructure Plan - Address protection of critical infrastructure
- **PM-9**: Risk Management Strategy - Develop risk management strategy
- **PM-10**: Authorization Process - Manage authorization process
- **PM-11**: Mission and Business Process Definition - Define mission and business processes
- **PM-12**: Insider Threat Program - Implement insider threat program
- **PM-13**: Security and Privacy Workforce - Establish security workforce program
- **PM-14**: Testing, Training, and Monitoring - Implement testing, training, monitoring process

### PS - Personnel Security

Screens and manages personnel with system access.

- **PS-1**: Policy and Procedures - Develop personnel security policy
- **PS-2**: Position Risk Designation - Assign risk designation to positions
- **PS-3**: Personnel Screening - Screen individuals prior to access
- **PS-4**: Personnel Termination - Upon termination, disable access and retrieve assets
- **PS-5**: Personnel Transfer - Review and modify access upon transfer
- **PS-6**: Access Agreements - Require signed access agreements
- **PS-7**: External Personnel Security - Establish security requirements for external personnel
- **PS-8**: Personnel Sanctions - Employ sanctions for security violations

### PT - PII Processing and Transparency (New in Rev. 5)

Governs personally identifiable information processing.

- **PT-1**: Policy and Procedures - Develop PII processing policy
- **PT-2**: Authority to Process PII - Establish authority to process PII
- **PT-3**: PII Processing Purposes - Document purposes of PII processing
- **PT-4**: Consent - Obtain consent for PII processing
- **PT-5**: Privacy Notice - Provide notice about PII processing
- **PT-6**: System of Records Notice - Publish SORNs for PII systems
- **PT-7**: Specific Categories of PII - Implement protections for sensitive PII
- **PT-8**: Computer Matching Requirements - Comply with computer matching requirements

### RA - Risk Assessment

Identifies and assesses risks to systems and organizations.

- **RA-1**: Policy and Procedures - Develop risk assessment policy
- **RA-2**: Security Categorization - Categorize system and information
- **RA-3**: Risk Assessment - Conduct risk assessments
- **RA-5**: Vulnerability Monitoring and Scanning - Monitor and scan for vulnerabilities
- **RA-7**: Risk Response - Respond to risk assessment findings
- **RA-9**: Criticality Analysis - Identify critical system components
- **RA-10**: Threat Hunting - Conduct threat hunting activities

### SA - System and Services Acquisition

Manages system development and acquisition.

- **SA-1**: Policy and Procedures - Develop system acquisition policy
- **SA-2**: Allocation of Resources - Allocate resources for security
- **SA-3**: System Development Life Cycle - Manage system using SDLC
- **SA-4**: Acquisition Process - Include security requirements in contracts
- **SA-5**: System Documentation - Obtain and protect system documentation
- **SA-8**: Security and Privacy Engineering Principles - Apply security engineering principles
- **SA-9**: External System Services - Require security controls for external services
- **SA-10**: Developer Configuration Management - Require developer CM processes
- **SA-11**: Developer Testing and Evaluation - Require developer security testing
- **SA-15**: Development Process, Standards, and Tools - Require secure development processes
- **SA-22**: Unsupported System Components - Replace unsupported components

### SC - System and Communications Protection

Protects communications and system boundaries.

- **SC-1**: Policy and Procedures - Develop system and communications protection policy
- **SC-2**: Separation of System and User Functionality - Separate system and user functionality
- **SC-3**: Security Function Isolation - Isolate security functions
- **SC-4**: Information in Shared System Resources - Prevent unauthorized information transfer
- **SC-5**: Denial-of-Service Protection - Protect against DoS attacks
- **SC-7**: Boundary Protection - Monitor and control communications at boundary
- **SC-8**: Transmission Confidentiality and Integrity - Protect information in transit
- **SC-10**: Network Disconnect - Terminate network connections after inactivity
- **SC-12**: Cryptographic Key Establishment and Management - Establish and manage cryptographic keys
- **SC-13**: Cryptographic Protection - Implement cryptographic mechanisms
- **SC-15**: Collaborative Computing Devices and Applications - Control collaborative computing
- **SC-17**: Public Key Infrastructure Certificates - Issue certificates using authorized PKI
- **SC-18**: Mobile Code - Define acceptable mobile code
- **SC-20**: Secure Name/Address Resolution Service - Provide secure DNS
- **SC-21**: Secure Name/Address Resolution Service (Recursive) - Request secure DNS from upstream
- **SC-22**: Architecture and Provisioning for Name/Address Resolution - Ensure fault tolerance for DNS
- **SC-23**: Session Authenticity - Protect session authenticity
- **SC-28**: Protection of Information at Rest - Protect information at rest
- **SC-39**: Process Isolation - Maintain separate execution domains

### SI - System and Information Integrity

Protects systems from flaws, malicious code, and intrusions.

- **SI-1**: Policy and Procedures - Develop system and information integrity policy
- **SI-2**: Flaw Remediation - Identify and remediate flaws
- **SI-3**: Malicious Code Protection - Implement malicious code protection
- **SI-4**: System Monitoring - Monitor system for attacks and anomalies
- **SI-5**: Security Alerts, Advisories, and Directives - Receive and respond to security alerts
- **SI-6**: Security and Privacy Function Verification - Verify security functions
- **SI-7**: Software, Firmware, and Information Integrity - Employ integrity verification
- **SI-8**: Spam Protection - Implement spam protection
- **SI-10**: Information Input Validation - Validate information inputs
- **SI-11**: Error Handling - Generate error messages without sensitive info
- **SI-12**: Information Management and Retention - Manage and retain information
- **SI-16**: Memory Protection - Implement memory protection

### SR - Supply Chain Risk Management (New in Rev. 5)

Manages supply chain security risks.

- **SR-1**: Policy and Procedures - Develop SCRM policy
- **SR-2**: Supply Chain Risk Management Plan - Develop SCRM plan
- **SR-3**: Supply Chain Controls and Processes - Establish controls for supply chain
- **SR-5**: Acquisition Strategies, Tools, and Methods - Employ security in acquisitions
- **SR-6**: Supplier Assessments and Reviews - Assess and review suppliers
- **SR-8**: Notification Agreements - Establish notification agreements with suppliers
- **SR-10**: Inspection of Systems or Components - Inspect systems/components upon delivery
- **SR-11**: Component Authenticity - Implement anti-counterfeit controls
- **SR-12**: Component Disposal - Dispose of components securely

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
