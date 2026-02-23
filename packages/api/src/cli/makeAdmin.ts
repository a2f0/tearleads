import type { Command } from 'commander';
import { buildPostgresConnectionLabel } from '../lib/cliPostgres.js';
import { normalizeEmail } from '../lib/createAccount.js';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';

type ParsedArgs = {
  email: string | null;
  help: boolean;
};

type MakeAdminOptions = {
  email?: string;
};

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  pnpm --filter @tearleads/api makeAdmin -- --email user@example.com',
      '  pnpm --filter @tearleads/api cli make-admin -- --email user@example.com',
      '  pnpm exec tsx scripts/makeAdmin.ts -- --email user@example.com',
      '',
      'Options:',
      '  --email, -e           Account email address (required).',
      '  --help, -h            Show this help message.',
      '',
      'Environment:',
      '  DATABASE_URL or POSTGRES_URL take precedence.',
      '  Otherwise PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE are used.',
      '  In dev mode, defaults to local Postgres',
      '  (Linux: /var/run/postgresql peer auth; others: localhost:5432)',
      '  and database tearleads_development.'
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

async function makeAdmin(email: string): Promise<void> {
  const label = buildPostgresConnectionLabel();
  const pool = await getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query<{ id: string }>(
      'UPDATE users SET admin = TRUE WHERE email = $1 RETURNING id',
      [email]
    );

    const updatedUser = result.rows[0];
    if (!updatedUser) {
      throw new Error(`No account found for ${email}.`);
    }

    await client.query('COMMIT');
    console.log(`Granted admin privileges to ${email} (id ${updatedUser.id}).`);
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

export async function runMakeAdmin(options: MakeAdminOptions): Promise<void> {
  const emailValue = options.email ?? null;
  if (!emailValue) {
    throw new Error('Email is required. Use --email or -e.');
  }

  const email = normalizeEmail(emailValue);
  await makeAdmin(email);
}

export async function runMakeAdminFromArgv(argv: string[]): Promise<void> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      printUsage();
      return;
    }

    const options: MakeAdminOptions = {};
    if (parsed.email) {
      options.email = parsed.email;
    }

    await runMakeAdmin(options);
  } finally {
    await closePostgresPool();
  }
}

export function makeAdminCommand(program: Command): void {
  program
    .command('make-admin')
    .description('Grant admin privileges to an existing account')
    .requiredOption('-e, --email <email>', 'Account email address')
    .action(async (options: MakeAdminOptions) => {
      let exitCode = 0;
      try {
        await runMakeAdmin(options);
      } catch (error) {
        exitCode = 1;
        console.error('\nMake admin failed:');
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        await closePostgresPool();
        process.exit(exitCode);
      }
    });
}
