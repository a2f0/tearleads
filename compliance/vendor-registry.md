# Vendor Registry

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-001 | policy=compliance/SOC2/policies/04-vendor-management-policy.md | procedure=compliance/SOC2/procedures/04-vendor-management-procedure.md | control=vendor-inventory -->

This document maintains a centralized inventory of all third-party vendors with whom Tearleads has a business relationship involving data processing, infrastructure services, or critical business functions.

## Registry Maintenance

- **Owner**: Security Owner
- **Review Frequency**: Quarterly
- **Last Review**: _Not yet reviewed_

## Vendor Categories

| Category | Description |
| --- | --- |
| Infrastructure | Cloud hosting, compute, storage, networking |
| Platform Services | Business-critical SaaS integrations |
| Development Tools | CI/CD, code review, AI-assisted development |
| Security | TLS certificates, key management |

## Vendor Inventory

### Tier 1: Critical Vendors

| Vendor | Service | Data Classification | Contract Type | Compliance |
| --- | --- | --- | --- | --- |
| [Hetzner Cloud](#hetzner-cloud) | VM hosting, DNS | System data, logs | Pay-as-you-go | ISO 27001, SOC 2 Type II |
| [Microsoft Azure](#microsoft-azure) | TEE/Confidential VMs, Key Vault | Sensitive workloads | Pay-as-you-go | SOC 2, ISO 27001, HIPAA BAA available |
| [Let's Encrypt](#lets-encrypt) | TLS certificates | None (public keys only) | Free/ISRG | WebTrust |

### Tier 2: Platform Services (Business Critical)

| Vendor | Service | Data Classification | Contract Type | Compliance |
| --- | --- | --- | --- | --- |
| [GitHub](#github) | Version control, CI/CD | Source code, secrets | Enterprise/Team | SOC 2 Type II, ISO 27001 |
| [RevenueCat](#revenuecat) | Subscription billing | Billing identifiers | SaaS | SOC 2 Type II |
| [OpenRouter](#openrouter) | AI/LLM API gateway | User prompts, responses | API credits | Privacy policy (SOC 2 pending - known gap) |

### Tier 3: Development Tools

| Vendor | Service | Data Classification | Contract Type | Compliance |
| --- | --- | --- | --- | --- |
| [Anthropic](#anthropic) | Claude Code (AI dev) | Code context | API/CLI | SOC 2 Type II |
| [OpenAI](#openai) | Codex (AI dev) | Code context | API | SOC 2 Type II |
| [Google](#google) | Gemini Code Assist | Code review context | API | SOC 2, ISO 27001 |

---

## Vendor Details

### Hetzner Cloud

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-002 | control=hetzner-cloud-vendor -->

- **Legal Entity**: Hetzner Online GmbH
- **Headquarters**: Gunzenhausen, Germany
- **Website**: <https://www.hetzner.com>
- **Service Description**: Primary cloud infrastructure provider for VM hosting and DNS management
- **Data Processed**: Application logs, system metrics, network traffic metadata
- **Data Residency**: EU (Germany/Finland)
- **Infrastructure Files**:
  - `terraform/modules/hetzner-server/` - VM provisioning
  - `terraform/modules/hetzner-dns/` - DNS configuration
  - `terraform/stacks/staging/k8s/main.tf` - Server configuration
- **Compliance Certifications**: ISO 27001, SOC 2 Type II, GDPR compliant
- **Security Controls**: SSH key-only authentication, firewall rules, encrypted storage
- **Contract Terms**: Standard Terms of Service
- **Data Processing Agreement**: Available upon request

### Microsoft Azure

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-003 | control=azure-vendor -->

- **Legal Entity**: Microsoft Corporation
- **Headquarters**: Redmond, WA, USA
- **Website**: <https://azure.microsoft.com>
- **Service Description**: Trusted Execution Environment (TEE) infrastructure for confidential computing
- **Data Processed**: Encrypted workloads, attestation data, sealed keys
- **Data Residency**: Configurable (US East by default)
- **Infrastructure Files**:
  - `terraform/modules/azure-tee/` - Modular TEE provisioning (VM, KV, Network)
  - `terraform/stacks/*/tee/` - Environment-specific TEE stacks
- **Compliance Certifications**: SOC 2 Type II, ISO 27001, HIPAA, FedRAMP
- **Security Controls**: AMD SEV-SNP hardware attestation, Key Vault RBAC, managed identity
- **Contract Terms**: Microsoft Customer Agreement
- **Data Processing Agreement**: Microsoft DPA (standard)

### Let's Encrypt

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-004 | control=letsencrypt-vendor -->

- **Legal Entity**: Internet Security Research Group (ISRG)
- **Headquarters**: San Francisco, CA, USA
- **Website**: <https://letsencrypt.org>
- **Service Description**: Automated TLS certificate issuance and renewal
- **Data Processed**: Domain names (public), public keys (public)
- **Data Residency**: N/A (certificates are public)
- **Infrastructure Files**:
  - `terraform/stacks/staging/k8s/main.tf` - Certbot configuration
- **Compliance Certifications**: WebTrust for CAs
- **Security Controls**: ACME protocol, domain validation
- **Contract Terms**: Subscriber Agreement
- **Data Processing Agreement**: N/A (no personal data)

### GitHub

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-005 | control=github-vendor -->

- **Legal Entity**: GitHub, Inc. (Microsoft subsidiary)
- **Headquarters**: San Francisco, CA, USA
- **Website**: <https://github.com>
- **Service Description**: Source code repository, CI/CD workflows, issue tracking
- **Data Processed**: Source code, commit history, CI artifacts, secrets (encrypted)
- **Data Residency**: USA (with EU data residency options)
- **Configuration Files**:
  - `.github/workflows/` - CI/CD workflow definitions
  - Repository settings and branch protections
- **Compliance Certifications**: SOC 2 Type II, ISO 27001
- **Security Controls**: 2FA required, branch protection, secret scanning, Dependabot
- **Contract Terms**: GitHub Terms of Service / Enterprise Agreement
- **Data Processing Agreement**: GitHub DPA

### RevenueCat

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-006 | control=revenuecat-vendor -->

- **Legal Entity**: RevenueCat, Inc.
- **Headquarters**: San Francisco, CA, USA
- **Website**: <https://www.revenuecat.com>
- **Service Description**: Mobile subscription and billing management platform
- **Data Processed**: Organization billing IDs, subscription status, entitlement state
- **Data Residency**: USA
- **Integration Files**:
  - `packages/api/src/lib/revenuecat.ts` - Webhook verification
  - `packages/api/src/routes/revenuecat/post-webhooks.ts` - Webhook handler
  - `packages/db/src/schema/definition.ts` - Billing tables
- **Compliance Certifications**: SOC 2 Type II
- **Security Controls**: HMAC-SHA256 webhook signatures, replay attack prevention
- **Contract Terms**: RevenueCat Terms of Service
- **Data Processing Agreement**: RevenueCat DPA
- **Related Policy**: [Payment Infrastructure Policy](./SOC2/policies/03-payment-infrastructure-policy.md)

### OpenRouter

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-007 | control=openrouter-vendor -->

- **Legal Entity**: OpenRouter, Inc.
- **Headquarters**: USA
- **Website**: <https://openrouter.ai>
- **Service Description**: AI/LLM API gateway providing access to multiple model providers
- **Data Processed**: Chat messages (prompts and completions), usage metrics
- **Data Residency**: Varies by model provider
- **Integration Files**:
  - `packages/api/src/routes/chat/post-completions.ts` - API integration
  - `packages/api/.env.example` - API key configuration
- **Compliance Certifications**: Privacy policy available
- **Security Controls**: API key authentication, rate limiting
- **Contract Terms**: OpenRouter Terms of Service
- **Data Processing Agreement**: Contact vendor
- **Environment Variables**: `OPENROUTER_API_KEY`

### Anthropic

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-008 | control=anthropic-vendor -->

- **Legal Entity**: Anthropic PBC
- **Headquarters**: San Francisco, CA, USA
- **Website**: <https://www.anthropic.com>
- **Service Description**: Claude Code AI-assisted development tooling
- **Data Processed**: Code context, file contents during development sessions
- **Data Residency**: USA
- **Usage Context**: Development team tooling (not production data path)
- **Configuration Files**:
  - `CLAUDE.md` - Agent instructions
  - `.claude/skills/` - Custom skills
- **Compliance Certifications**: SOC 2 Type II
- **Security Controls**: Conversation isolation, no training on customer data
- **Contract Terms**: Anthropic Terms of Service
- **Data Processing Agreement**: Anthropic DPA

### OpenAI

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-009 | control=openai-vendor -->

- **Legal Entity**: OpenAI, L.L.C.
- **Headquarters**: San Francisco, CA, USA
- **Website**: <https://openai.com>
- **Service Description**: Codex AI-assisted development tooling
- **Data Processed**: Code context during development sessions
- **Data Residency**: USA
- **Usage Context**: Development team tooling (not production data path)
- **Configuration Files**:
  - `AGENTS.md` - Agent instructions
  - `.codex/skills/` - Custom skills
- **Compliance Certifications**: SOC 2 Type II
- **Security Controls**: API authentication, data retention controls
- **Contract Terms**: OpenAI Terms of Use
- **Data Processing Agreement**: OpenAI DPA

### Google

<!-- COMPLIANCE_SENTINEL: TL-VENDOR-010 | control=google-gemini-vendor -->

- **Legal Entity**: Google LLC (Alphabet Inc.)
- **Headquarters**: Mountain View, CA, USA
- **Website**: <https://cloud.google.com>
- **Service Description**: Gemini Code Assist for automated code review
- **Data Processed**: Pull request diffs, code review context
- **Data Residency**: USA (configurable)
- **Usage Context**: CI/CD code review automation
- **Configuration Files**:
  - `.gemini/INSTRUCTIONS.md` - Review instructions
- **Compliance Certifications**: SOC 2 Type II, ISO 27001, HIPAA
- **Security Controls**: OAuth authentication, audit logging
- **Contract Terms**: Google Cloud Terms of Service
- **Data Processing Agreement**: Google Cloud DPA

---

## Risk Assessment Summary

| Vendor | Criticality | Data Sensitivity | Replaceability | Risk Level |
| --- | --- | --- | --- | --- |
| Hetzner Cloud | Critical | Medium | Medium | Medium |
| Microsoft Azure | Critical | High | Low | Medium |
| Let's Encrypt | High | Low | Low | Low |
| GitHub | Critical | High | Low | Medium |
| RevenueCat | Critical | Medium | Medium | Medium |
| OpenRouter | Medium | Medium | High | Low |
| Anthropic | Low | Medium | High | Low |
| OpenAI | Low | Medium | High | Low |
| Google | Low | Low | High | Low |

---

## Sentinel Index

| Sentinel | Vendor | Control |
| --- | --- | --- |
| `TL-VENDOR-001` | Registry | vendor-inventory |
| `TL-VENDOR-002` | Hetzner Cloud | hetzner-cloud-vendor |
| `TL-VENDOR-003` | Microsoft Azure | azure-vendor |
| `TL-VENDOR-004` | Let's Encrypt | letsencrypt-vendor |
| `TL-VENDOR-005` | GitHub | github-vendor |
| `TL-VENDOR-006` | RevenueCat | revenuecat-vendor |
| `TL-VENDOR-007` | OpenRouter | openrouter-vendor |
| `TL-VENDOR-008` | Anthropic | anthropic-vendor |
| `TL-VENDOR-009` | OpenAI | openai-vendor |
| `TL-VENDOR-010` | Google | google-gemini-vendor |

---

## Change Log

| Date | Change | Author |
| --- | --- | --- |
| _Initial_ | Created vendor registry | Agent |
