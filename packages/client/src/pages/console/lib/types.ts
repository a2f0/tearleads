/**
 * TypeScript interfaces for the virtual terminal emulator.
 */

/** Available terminal commands */
export type CommandName =
  | 'setup'
  | 'unlock'
  | 'lock'
  | 'backup'
  | 'restore'
  | 'password'
  | 'help'
  | 'status'
  | 'clear';

/** Parsed command from user input */
export interface ParsedCommand {
  name: CommandName | null;
  args: string[];
  flags: Record<string, boolean | string>;
  raw: string;
}

/** Output line type for styling */
export type OutputLineType = 'command' | 'output' | 'error' | 'success';

/** Single line of terminal output */
export interface OutputLine {
  id: string;
  content: string;
  type: OutputLineType;
}

/** Terminal input mode */
export type InputMode = 'command' | 'password' | 'confirm';

/** State for a pending multi-step command */
export interface PendingCommand {
  name: CommandName;
  step: string;
  data: Record<string, string>;
}

/** Terminal state */
export interface TerminalState {
  lines: OutputLine[];
  mode: InputMode;
  prompt: string;
  input: string;
  isProcessing: boolean;
  pendingCommand: PendingCommand | null;
}

/** Command metadata for help display */
export interface CommandHelp {
  name: CommandName;
  description: string;
  args?: string;
  flags?: string[];
}

/** Map of all available commands and their help info */
export const COMMAND_HELP: Record<CommandName, CommandHelp> = {
  setup: {
    name: 'setup',
    description: 'Initialize a new database with a password'
  },
  unlock: {
    name: 'unlock',
    description: 'Unlock the database with your password',
    flags: ['--persist: Keep the session active across page reloads']
  },
  lock: {
    name: 'lock',
    description: 'Lock the database',
    flags: ['--clear: Clear the persisted session']
  },
  backup: {
    name: 'backup',
    description: 'Export the database to a backup file',
    args: '[filename]'
  },
  restore: {
    name: 'restore',
    description: 'Import a database backup file',
    flags: ['--force: Skip confirmation prompt']
  },
  password: {
    name: 'password',
    description: 'Change the database password'
  },
  help: {
    name: 'help',
    description: 'Show available commands or command details',
    args: '[command]'
  },
  status: {
    name: 'status',
    description: 'Show current database status'
  },
  clear: {
    name: 'clear',
    description: 'Clear terminal output'
  }
};

/** List of valid command names */
export const VALID_COMMANDS: CommandName[] = Object.keys(
  COMMAND_HELP
) as CommandName[];

/** Default prompt displayed in command mode */
export const DEFAULT_PROMPT = 'tearleads> ';
