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
      frameworkDocuments.some(
        (document) => document.docPath === 'POLICY_INDEX.md'
      )
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

  it('preserves query and hash for internal markdown links', () => {
    const resolved = resolveComplianceLink({
      frameworkId: 'SOC2',
      currentDocPath: 'POLICY_INDEX.md',
      href: './policies/01-account-management-policy.md?view=compact#details'
    });

    expect(resolved).toBe(
      '/compliance/SOC2/policies/01-account-management-policy.md?view=compact#details'
    );
  });

  it('returns null for empty and hash-only links', () => {
    const emptyHref = resolveComplianceLink({
      frameworkId: 'SOC2',
      currentDocPath: 'POLICY_INDEX.md',
      href: '   '
    });
    const hashHref = resolveComplianceLink({
      frameworkId: 'SOC2',
      currentDocPath: 'POLICY_INDEX.md',
      href: '#top'
    });

    expect(emptyHref).toBeNull();
    expect(hashHref).toBeNull();
  });

  it('passes through already-routed compliance links', () => {
    const resolved = resolveComplianceLink({
      frameworkId: 'SOC2',
      currentDocPath: 'POLICY_INDEX.md',
      href: '/compliance/SOC2/POLICY_INDEX.md'
    });

    expect(resolved).toBe('/compliance/SOC2/POLICY_INDEX.md');
  });

  it('returns null for non-markdown and invalid upward paths', () => {
    const nonMarkdown = resolveComplianceLink({
      frameworkId: 'SOC2',
      currentDocPath: 'POLICY_INDEX.md',
      href: './policies'
    });
    const invalidUpward = resolveComplianceLink({
      frameworkId: 'SOC2',
      currentDocPath: 'POLICY_INDEX.md',
      href: '../../../outside.md'
    });

    expect(nonMarkdown).toBeNull();
    expect(invalidUpward).toBeNull();
  });

  it('normalizes undefined and rooted compliance document lookups', () => {
    const defaultDoc = getComplianceDocument('SOC2', undefined);
    const rootedDoc = getComplianceDocument('SOC2', '/POLICY_INDEX.md');

    expect(defaultDoc).not.toBeNull();
    expect(rootedDoc).not.toBeNull();
    expect(rootedDoc?.docPath).toBe('POLICY_INDEX.md');
  });

  it('returns an empty list for unknown frameworks', () => {
    expect(getFrameworkDocuments('DOES_NOT_EXIST')).toEqual([]);
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
