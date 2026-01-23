import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { buildCreateAccountInput } from '../lib/create-account.js';
import { hashPassword } from '../lib/passwords.js';
import {
  closePostgresPool,
  getPostgresConnectionInfo,
  getPostgresPool
} from '../lib/postgres.js';

type ParsedArgs = {
  email: string | null;
  password: string | null;
  passwordFromStdin: boolean;
  help: boolean;
};

type CreateAccountOptions = {
  email?: string;
  password?: string;
  passwordStdin?: boolean;
};

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  pnpm --filter @rapid/api createAccount -- --email user@example.com --password "secret"',
      '  pnpm --filter @rapid/api createAccount -- --email user@example.com --password-stdin',
      '  pnpm --filter @rapid/api cli create-account -- --email user@example.com --password "secret"',
      '  pnpm --filter @rapid/api cli create-account -- --email user@example.com --password-stdin',
      '  pnpm exec tsx scripts/createAccount.ts -- --email user@example.com --password "secret"',
      '  pnpm exec tsx scripts/createAccount.ts -- --email user@example.com --password-stdin',
      '',
      'Options:',
      '  --email, -e           Account email address (required).',
      '  --password, -p        Account password (required unless --password-stdin).',
      '  --password-stdin      Read password from stdin.',
      '  --help, -h            Show this help message.',
      '',
      'Environment:',
      '  DATABASE_URL or POSTGRES_URL take precedence.',
      '  Otherwise PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE are used.',
      '  In dev mode, defaults to localhost:5432 and tearleads_development.'
    ].join('\n')
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  let email: string | null = null;
  let password: string | null = null;
  let passwordFromStdin = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--password-stdin') {
      passwordFromStdin = true;
      continue;
    }

    if (arg.startsWith('--email=')) {
      email = arg.slice('--email='.length);
      continue;
    }

    if (arg.startsWith('--password=')) {
      password = arg.slice('--password='.length);
      continue;
    }

    if (arg === '--email' || arg === '-e') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --email.');
      }
      email = value;
      index += 1;
      continue;
    }

    if (arg === '--password' || arg === '-p') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --password.');
      }
      password = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { email, password, passwordFromStdin, help };
}

function buildConnectionLabel(): string {
  const info = getPostgresConnectionInfo();
  const database = info.database ?? null;
  if (!database) {
    throw new Error(
      'Missing Postgres connection info. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE (plus PGHOST/PGPORT/PGUSER as needed).'
    );
  }

  const labelParts = [
    info.host ? `host=${info.host}` : null,
    info.port ? `port=${info.port}` : null,
    info.user ? `user=${info.user}` : null,
    `database=${database}`
  ].filter((value): value is string => Boolean(value));

  return labelParts.join(', ');
}

async function createAccount(email: string, password: string): Promise<void> {
  const label = buildConnectionLabel();
  const pool = await getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingUser = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      throw new Error(`Account already exists for ${email}.`);
    }

    const userId = randomUUID();
    const { salt, hash } = await hashPassword(password);

    await client.query(
      'INSERT INTO users (id, email, email_confirmed) VALUES ($1, $2, $3)',
      [userId, email, false]
    );

    await client.query(
      'INSERT INTO user_credentials (user_id, password_hash, password_salt, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
      [userId, hash, salt]
    );

    await client.query('COMMIT');
    console.log(`Created account ${email} (id ${userId}).`);
    console.log(`Postgres connection: ${label}`);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to rollback transaction:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function runCreateAccount(
  options: CreateAccountOptions
): Promise<void> {
  const emailValue = options.email ?? null;
  const passwordValue = options.password ?? null;
  const passwordFromStdin = options.passwordStdin ?? false;

  if (!emailValue) {
    throw new Error('Email is required. Use --email or -e.');
  }

  if (passwordValue && passwordFromStdin) {
    throw new Error('Use either --password or --password-stdin, not both.');
  }
  if (!passwordValue && !passwordFromStdin) {
    throw new Error(
      'Password is required. Use --password or --password-stdin.'
    );
  }

  const passwordInput = passwordFromStdin
    ? readFileSync(0, 'utf8')
    : (passwordValue ?? '');

  const { email, password } = buildCreateAccountInput(
    emailValue,
    passwordInput
  );

  await createAccount(email, password);
}

export async function runCreateAccountFromArgv(argv: string[]): Promise<void> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      printUsage();
      return;
    }

    const options: CreateAccountOptions = {};
    if (parsed.email) {
      options.email = parsed.email;
    }
    if (parsed.password) {
      options.password = parsed.password;
    }
    if (parsed.passwordFromStdin) {
      options.passwordStdin = true;
    }

    await runCreateAccount(options);
  } finally {
    await closePostgresPool();
  }
}

export function createAccountCommand(program: Command): void {
  program
    .command('create-account')
    .description('Create an account in the database')
    .requiredOption('-e, --email <email>', 'Account email address')
    .option('-p, --password <password>', 'Account password')
    .option('--password-stdin', 'Read password from stdin')
    .action(async (options: CreateAccountOptions) => {
      let exitCode = 0;
      try {
        await runCreateAccount(options);
      } catch (error) {
        exitCode = 1;
        console.error('\nCreate account failed:');
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        await closePostgresPool();
        process.exit(exitCode);
      }
    });
}
