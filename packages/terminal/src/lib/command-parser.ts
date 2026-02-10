/**
 * Parser for terminal command input.
 */

import type { CommandName, ParsedCommand } from './types';
import { VALID_COMMANDS } from './types';

/**
 * Parse a raw command string into structured command parts.
 *
 * Supports:
 * - Command names (e.g., "setup", "unlock")
 * - Positional arguments (e.g., "help status")
 * - Boolean flags (e.g., "--persist", "--force")
 * - Flags with values (e.g., "--output=file.db")
 *
 * @param input - Raw command string from user
 * @returns Parsed command object
 */
export function parseCommand(input: string): ParsedCommand {
  const raw = input.trim();

  if (!raw) {
    return { name: null, args: [], flags: {}, raw };
  }

  // Split on whitespace, respecting quoted strings
  const tokens = tokenize(raw);

  const firstToken = tokens[0];
  if (tokens.length === 0 || !firstToken) {
    return { name: null, args: [], flags: {}, raw };
  }

  const commandToken = firstToken.toLowerCase();
  const name = VALID_COMMANDS.includes(commandToken as CommandName)
    ? (commandToken as CommandName)
    : null;

  const args: string[] = [];
  const flags: Record<string, boolean | string> = {};

  // Process remaining tokens
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (token.startsWith('--')) {
      // Handle flag with value (--flag=value)
      const equalIndex = token.indexOf('=');
      if (equalIndex !== -1) {
        const flagName = token.slice(2, equalIndex);
        const flagValue = token.slice(equalIndex + 1);
        flags[flagName] = flagValue;
      } else {
        // Boolean flag (--flag)
        const flagName = token.slice(2);
        flags[flagName] = true;
      }
    } else if (token.startsWith('-') && token.length > 1) {
      // Short flag (-p)
      const flagName = token.slice(1);
      flags[flagName] = true;
    } else {
      // Positional argument
      args.push(token);
    }
  }

  return { name, args, flags, raw };
}

/**
 * Tokenize input string, handling quoted strings.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuote) {
      if (char === inQuote) {
        // End of quoted section
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      // Start of quoted section
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      // Whitespace delimiter
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  // Add final token
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Check if input is a valid command name.
 */
export function isValidCommand(input: string): input is CommandName {
  return VALID_COMMANDS.includes(input.toLowerCase() as CommandName);
}
