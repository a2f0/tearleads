import type { Command } from 'commander';
import { buildPostgresConnectionLabel } from '../lib/cliPostgres.js';
import { normalizeEmail } from '../lib/createAccount.js';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';

type ParsedArgs = {
  email: string | null;
  help: boolean;
};

type DeleteAccountOptions = {
  email?: string;
};

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  pnpm --filter @tearleads/api deleteAccount -- --email user@example.com',
      '  pnpm --filter @tearleads/api cli delete-account -- --email user@example.com',
      '  pnpm exec tsx scripts/deleteAccount.ts -- --email user@example.com',
      '',
      'Options:',
      '  --email, -e           Account email address (required).',
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

    if (arg.startsWith('--email=')) {
      email = arg.slice('--email='.length);
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { email, help };
}

async function deleteAccount(email: string): Promise<void> {
  const label = buildPostgresConnectionLabel();
  const pool = await getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query<{ id: string }>(
      'DELETE FROM users WHERE email = $1 RETURNING id',
      [email]
    );

    const deletedUser = result.rows[0];
    if (!deletedUser) {
      throw new Error(`No account found for ${email}.`);
    }

    await client.query('COMMIT');
    console.log(`Deleted account ${email} (id ${deletedUser.id}).`);
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

async function runDeleteAccount(options: DeleteAccountOptions): Promise<void> {
  const emailValue = options.email ?? null;
  if (!emailValue) {
    throw new Error('Email is required. Use --email or -e.');
  }

  const email = normalizeEmail(emailValue);
  await deleteAccount(email);
}

export async function runDeleteAccountFromArgv(argv: string[]): Promise<void> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      printUsage();
      return;
    }

    const options: DeleteAccountOptions = {};
    if (parsed.email) {
      options.email = parsed.email;
    }

    await runDeleteAccount(options);
  } finally {
    await closePostgresPool();
  }
}

export function deleteAccountCommand(program: Command): void {
  program
    .command('delete-account')
    .description('Delete an account from the database')
    .requiredOption('-e, --email <email>', 'Account email address')
    .action(async (options: DeleteAccountOptions) => {
      let exitCode = 0;
      try {
        await runDeleteAccount(options);
      } catch (error) {
        exitCode = 1;
        console.error('\nDelete account failed:');
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        await closePostgresPool();
        process.exit(exitCode);
      }
    });
}
