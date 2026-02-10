import { describe, expect, it } from 'vitest';
import { isValidCommand, parseCommand } from './command-parser';

describe('parseCommand', () => {
  it('parses empty input', () => {
    const result = parseCommand('');
    expect(result).toEqual({
      name: null,
      args: [],
      flags: {},
      raw: ''
    });
  });

  it('parses whitespace-only input', () => {
    const result = parseCommand('   ');
    expect(result).toEqual({
      name: null,
      args: [],
      flags: {},
      raw: ''
    });
  });

  it('parses a simple command', () => {
    const result = parseCommand('status');
    expect(result).toEqual({
      name: 'status',
      args: [],
      flags: {},
      raw: 'status'
    });
  });

  it('parses command case-insensitively', () => {
    const result = parseCommand('STATUS');
    expect(result).toEqual({
      name: 'status',
      args: [],
      flags: {},
      raw: 'STATUS'
    });
  });

  it('parses command with positional argument', () => {
    const result = parseCommand('help status');
    expect(result).toEqual({
      name: 'help',
      args: ['status'],
      flags: {},
      raw: 'help status'
    });
  });

  it('parses command with multiple arguments', () => {
    const result = parseCommand('backup myfile.db extra');
    expect(result).toEqual({
      name: 'backup',
      args: ['myfile.db', 'extra'],
      flags: {},
      raw: 'backup myfile.db extra'
    });
  });

  it('parses boolean flag', () => {
    const result = parseCommand('unlock --persist');
    expect(result).toEqual({
      name: 'unlock',
      args: [],
      flags: { persist: true },
      raw: 'unlock --persist'
    });
  });

  it('parses multiple boolean flags', () => {
    const result = parseCommand('lock --clear --force');
    expect(result).toEqual({
      name: 'lock',
      args: [],
      flags: { clear: true, force: true },
      raw: 'lock --clear --force'
    });
  });

  it('parses flag with value', () => {
    const result = parseCommand('backup --output=mybackup.db');
    expect(result).toEqual({
      name: 'backup',
      args: [],
      flags: { output: 'mybackup.db' },
      raw: 'backup --output=mybackup.db'
    });
  });

  it('parses short flags', () => {
    const result = parseCommand('unlock -p');
    expect(result).toEqual({
      name: 'unlock',
      args: [],
      flags: { p: true },
      raw: 'unlock -p'
    });
  });

  it('parses mixed args and flags', () => {
    const result = parseCommand('help setup --verbose extra');
    expect(result).toEqual({
      name: 'help',
      args: ['setup', 'extra'],
      flags: { verbose: true },
      raw: 'help setup --verbose extra'
    });
  });

  it('parses quoted arguments', () => {
    const result = parseCommand('backup "my file.db"');
    expect(result).toEqual({
      name: 'backup',
      args: ['my file.db'],
      flags: {},
      raw: 'backup "my file.db"'
    });
  });

  it('parses single-quoted arguments', () => {
    const result = parseCommand("backup 'my file.db'");
    expect(result).toEqual({
      name: 'backup',
      args: ['my file.db'],
      flags: {},
      raw: "backup 'my file.db'"
    });
  });

  it('returns null name for unknown command', () => {
    const result = parseCommand('unknown');
    expect(result).toEqual({
      name: null,
      args: [],
      flags: {},
      raw: 'unknown'
    });
  });

  it('handles extra whitespace', () => {
    const result = parseCommand('  unlock   --persist   ');
    expect(result).toEqual({
      name: 'unlock',
      args: [],
      flags: { persist: true },
      raw: 'unlock   --persist'
    });
  });

  it('parses all valid commands', () => {
    const commands = [
      'setup',
      'unlock',
      'lock',
      'backup',
      'restore',
      'password',
      'help',
      'status',
      'clear'
    ];

    for (const cmd of commands) {
      const result = parseCommand(cmd);
      expect(result.name).toBe(cmd);
    }
  });
});

describe('isValidCommand', () => {
  it('returns true for valid commands', () => {
    expect(isValidCommand('setup')).toBe(true);
    expect(isValidCommand('unlock')).toBe(true);
    expect(isValidCommand('lock')).toBe(true);
    expect(isValidCommand('backup')).toBe(true);
    expect(isValidCommand('restore')).toBe(true);
    expect(isValidCommand('password')).toBe(true);
    expect(isValidCommand('help')).toBe(true);
    expect(isValidCommand('status')).toBe(true);
    expect(isValidCommand('clear')).toBe(true);
  });

  it('returns false for invalid commands', () => {
    expect(isValidCommand('invalid')).toBe(false);
    expect(isValidCommand('foo')).toBe(false);
    expect(isValidCommand('')).toBe(false);
  });

  it('handles case-insensitive input', () => {
    expect(isValidCommand('SETUP')).toBe(true);
    expect(isValidCommand('UnLoCk')).toBe(true);
  });
});
