import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClientTerminal } from './ClientTerminal';

const mockDb = {
  isLoading: false,
  isSetUp: true,
  isUnlocked: true,
  hasPersistedSession: false,
  currentInstanceName: 'Default',
  setup: vi.fn(),
  unlock: vi.fn(),
  restoreSession: vi.fn(),
  lock: vi.fn(),
  exportDatabase: vi.fn(),
  importDatabase: vi.fn(),
  changePassword: vi.fn()
};

const mockTerminalBase = vi.fn(() => <div data-testid="terminal-base" />);

vi.mock('@rapid/terminal', () => ({
  Terminal: (props: unknown) => {
    mockTerminalBase(props);
    return <div data-testid="terminal-base" />;
  }
}));

vi.mock('@rapid/terminal/package.json', () => ({
  default: { version: '9.9.9' }
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDb
}));

vi.mock('@/lib/errors', () => ({
  getErrorMessage: (error: unknown) => String(error)
}));

vi.mock('@/lib/file-utils', () => ({
  generateBackupFilename: () => 'backup.db',
  readFileAsUint8Array: async () => new Uint8Array([1]),
  saveFile: async () => {}
}));

describe('ClientTerminal', () => {
  it('passes db utilities and package version to terminal package', () => {
    render(<ClientTerminal className="my-terminal" autoFocus={false} />);

    expect(mockTerminalBase).toHaveBeenCalledWith(
      expect.objectContaining({
        db: mockDb,
        version: '9.9.9',
        className: 'my-terminal',
        autoFocus: false,
        utilities: expect.objectContaining({
          getErrorMessage: expect.any(Function),
          generateBackupFilename: expect.any(Function),
          readFileAsUint8Array: expect.any(Function),
          saveFile: expect.any(Function)
        })
      })
    );
  });

  it('omits className when not provided', () => {
    render(<ClientTerminal />);

    expect(mockTerminalBase).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ className: expect.anything() })
    );
  });
});
