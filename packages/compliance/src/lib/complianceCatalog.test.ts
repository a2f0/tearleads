import { describe, expect, it } from 'vitest';
import {
  getComplianceDocument,
  getComplianceFrameworks,
  getFrameworkDocuments,
  resolveComplianceLink
} from './complianceCatalog';

describe('complianceCatalog', () => {
  it('discovers compliance frameworks with documents', () => {
    const frameworks = getComplianceFrameworks();
    const frameworkIds = frameworks.map((framework) => framework.id);

    expect(frameworkIds).toContain('SOC2');
    expect(frameworkIds).toContain('HIPAA');
    expect(frameworkIds).toContain('NIST.SP.800-53');
    expect(frameworks.every((framework) => framework.documentCount > 0)).toBe(
      true
    );
  });

  it('loads known framework documents', () => {
    const frameworkDocuments = getFrameworkDocuments('SOC2');

    expect(
      frameworkDocuments.some((document) => document.docPath === 'POLICY_INDEX.md')
    ).toBe(true);

    const policyIndex = getComplianceDocument('SOC2', 'POLICY_INDEX.md');
    expect(policyIndex).not.toBeNull();
    expect(policyIndex?.source.length).toBeGreaterThan(100);
  });

  it('resolves internal markdown links to compliance routes', () => {
    const resolved = resolveComplianceLink({
      frameworkId: 'SOC2',
      currentDocPath: 'POLICY_INDEX.md',
      href: './policies/01-account-management-policy.md'
    });

    expect(resolved).toBe(
      '/compliance/SOC2/policies/01-account-management-policy.md'
    );
  });

  it('returns null for external links', () => {
    const resolved = resolveComplianceLink({
      frameworkId: 'SOC2',
      currentDocPath: 'POLICY_INDEX.md',
      href: 'https://example.com'
    });

    expect(resolved).toBeNull();
  });
});
