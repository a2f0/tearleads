import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsSection } from './SettingsSection';

describe('SettingsSection', () => {
  it('renders children', () => {
    render(
      <SettingsSection>
        <span data-testid="child">Test content</span>
      </SettingsSection>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('applies default styling', () => {
    render(
      <SettingsSection>
        <span>Content</span>
      </SettingsSection>
    );

    const section = screen.getByText('Content').parentElement;
    expect(section?.className).toContain('rounded-lg');
    expect(section?.className).toContain('border');
    expect(section?.className).toContain('p-4');
  });

  it('merges custom className with defaults', () => {
    render(
      <SettingsSection className="space-y-4">
        <span>Content</span>
      </SettingsSection>
    );

    const section = screen.getByText('Content').parentElement;
    expect(section?.className).toContain('rounded-lg');
    expect(section?.className).toContain('border');
    expect(section?.className).toContain('p-4');
    expect(section?.className).toContain('space-y-4');
  });
});
