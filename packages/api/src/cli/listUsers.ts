import type { Command } from 'commander';
import { buildPostgresConnectionLabel } from '../lib/cliPostgres.js';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';

type ParsedArgs = {
  help: boolean;
};

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  pnpm --filter @tearleads/api cli list-users',
      '  pnpm exec tsx scripts/users/listUsers.ts',
      '',
      'Options:',
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
  let help = false;

  for (const arg of argv) {
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { help };
}

export type UserRow = {
  id: string;
  email: string;
  admin: boolean;
};

export async function getUsers(): Promise<UserRow[]> {
  const pool = await getPostgresPool();
  const client = await pool.connect();
  try {
    const result = await client.query<UserRow>(
      'SELECT id, email, admin FROM users ORDER BY email'
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function listUsers(): Promise<void> {
  const label = buildPostgresConnectionLabel();
  const rows = await getUsers();

  if (rows.length === 0) {
    console.log('No user accounts found.');
  } else {
    console.log('User accounts:');
    for (const row of rows) {
      const adminTag = row.admin ? ' [admin]' : '';
      console.log(`- ${row.email} (id ${row.id})${adminTag}`);
    }
  }

  console.log(`Postgres connection: ${label}`);
}

export async function runListUsers(): Promise<void> {
  await listUsers();
}

export async function runListUsersFromArgv(argv: string[]): Promise<void> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      printUsage();
      return;
    }

    await runListUsers();
  } finally {
    await closePostgresPool();
  }
}

export function listUsersCommand(program: Command): void {
  program
    .command('list-users')
    .description('List all user accounts')
    .action(async () => {
      let exitCode = 0;
      try {
        await runListUsers();
      } catch (error) {
        exitCode = 1;
        console.error('\nList users failed:');
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        await closePostgresPool();
        process.exit(exitCode);
      }
    });
}
