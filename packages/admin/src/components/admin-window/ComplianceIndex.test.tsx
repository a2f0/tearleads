import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ComplianceIndex } from './ComplianceIndex';

vi.mock('@tearleads/compliance', () => ({
  getComplianceFrameworks: () => [
    { id: 'SOC2', label: 'SOC 2', defaultRoutePath: '/compliance/SOC2' },
    { id: 'HIPAA', label: 'HIPAA', defaultRoutePath: '/compliance/HIPAA' }
  ]
}));

vi.mock('@tearleads/ui', () => ({
  IconSquare: ({
    icon: _icon,
    label,
    onClick
  }: {
    icon: React.ComponentType;
    label: string;
    onClick: () => void;
  }) => (
    <button type="button" onClick={onClick} data-testid={`icon-${label}`}>
      {label}
    </button>
  )
}));

describe('ComplianceIndex', () => {
  it('renders compliance heading and description', () => {
    render(<ComplianceIndex onFrameworkSelect={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'Compliance' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Browse regulatory policy indexes/)
    ).toBeInTheDocument();
  });

  it('renders framework buttons', () => {
    render(<ComplianceIndex onFrameworkSelect={vi.fn()} />);

    expect(screen.getByTestId('icon-SOC 2')).toBeInTheDocument();
    expect(screen.getByTestId('icon-HIPAA')).toBeInTheDocument();
  });

  it('calls onFrameworkSelect when a framework is clicked', async () => {
    const user = userEvent.setup();
    const onFrameworkSelect = vi.fn();
    render(<ComplianceIndex onFrameworkSelect={onFrameworkSelect} />);

    await user.click(screen.getByTestId('icon-SOC 2'));

    expect(onFrameworkSelect).toHaveBeenCalledWith('SOC2');
  });
});
