import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OutputLine } from '../lib/types';
import { TerminalOutput } from './TerminalOutput';

describe('TerminalOutput', () => {
  it('renders empty when no lines', () => {
    render(<TerminalOutput lines={[]} />);
    const output = screen.getByTestId('terminal-output');
    expect(output).toBeEmptyDOMElement();
  });

  it('renders output lines', () => {
    const lines: OutputLine[] = [
      { id: '1', content: 'Hello', type: 'output' },
      { id: '2', content: 'World', type: 'output' }
    ];
    render(<TerminalOutput lines={lines} />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('World')).toBeInTheDocument();
  });

  it('renders command lines with correct styling', () => {
    const lines: OutputLine[] = [
      { id: '1', content: '> status', type: 'command' }
    ];
    render(<TerminalOutput lines={lines} />);

    const line = screen.getByText('> status');
    expect(line).toHaveClass('text-zinc-400');
  });

  it('renders error lines with correct styling', () => {
    const lines: OutputLine[] = [
      { id: '1', content: 'Error occurred', type: 'error' }
    ];
    render(<TerminalOutput lines={lines} />);

    const line = screen.getByText('Error occurred');
    expect(line).toHaveClass('text-red-400');
  });

  it('renders success lines with correct styling', () => {
    const lines: OutputLine[] = [
      { id: '1', content: 'Success!', type: 'success' }
    ];
    render(<TerminalOutput lines={lines} />);

    const line = screen.getByText('Success!');
    expect(line).toHaveClass('text-emerald-400');
  });

  it('renders output lines with correct styling', () => {
    const lines: OutputLine[] = [
      { id: '1', content: 'Regular output', type: 'output' }
    ];
    render(<TerminalOutput lines={lines} />);

    const line = screen.getByText('Regular output');
    expect(line).toHaveClass('text-zinc-100');
  });

  it('applies custom className', () => {
    render(<TerminalOutput lines={[]} className="custom-class" />);

    const output = screen.getByTestId('terminal-output');
    expect(output).toHaveClass('custom-class');
  });

  it('has proper accessibility attributes', () => {
    render(<TerminalOutput lines={[]} />);

    const output = screen.getByTestId('terminal-output');
    expect(output).toHaveAttribute('role', 'log');
    expect(output).toHaveAttribute('aria-live', 'polite');
    expect(output).toHaveAttribute('aria-label', 'Terminal output');
  });

  it('renders multiple line types correctly', () => {
    const lines: OutputLine[] = [
      { id: '1', content: '> setup', type: 'command' },
      { id: '2', content: 'Initializing...', type: 'output' },
      { id: '3', content: 'Database initialized.', type: 'success' },
      { id: '4', content: 'Warning: test failed', type: 'error' }
    ];
    render(<TerminalOutput lines={lines} />);

    expect(screen.getByText('> setup')).toHaveClass('text-zinc-400');
    expect(screen.getByText('Initializing...')).toHaveClass('text-zinc-100');
    expect(screen.getByText('Database initialized.')).toHaveClass(
      'text-emerald-400'
    );
    expect(screen.getByText('Warning: test failed')).toHaveClass(
      'text-red-400'
    );
  });
});
