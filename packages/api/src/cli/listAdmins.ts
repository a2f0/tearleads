import type { Command } from 'commander';
import { buildPostgresConnectionLabel } from '../lib/cliPostgres.js';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';

type ParsedArgs = {
  help: boolean;
  json: boolean;
};

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  pnpm --filter @tearleads/api cli list-admins',
      '  pnpm exec tsx scripts/listAdmins.ts',
      '',
      'Options:',
      '  --help, -h            Show this help message.',
      '  --json                Output as JSON array.',
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
  let json = false;

  for (const arg of argv) {
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--json') {
      json = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { help, json };
}

export type AdminRow = {
  id: string;
  email: string;
};

export async function getAdminUsers(): Promise<AdminRow[]> {
  const pool = await getPostgresPool();
  const client = await pool.connect();
  try {
    const result = await client.query<AdminRow>(
      'SELECT id, email FROM users WHERE admin = TRUE ORDER BY email'
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function listAdmins(json: boolean): Promise<void> {
  const rows = await getAdminUsers();

  if (json) {
    console.log(JSON.stringify(rows));
    return;
  }

  const label = buildPostgresConnectionLabel();

  if (rows.length === 0) {
    console.log('No admin accounts found.');
  } else {
    console.log('Admin accounts:');
    for (const row of rows) {
      console.log(`- ${row.email} (id ${row.id})`);
    }
  }

  console.log(`Postgres connection: ${label}`);
}

export async function runListAdmins(json = false): Promise<void> {
  await listAdmins(json);
}

export async function runListAdminsFromArgv(argv: string[]): Promise<void> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      printUsage();
      return;
    }

    await runListAdmins(parsed.json);
  } finally {
    await closePostgresPool();
  }
}

export function listAdminsCommand(program: Command): void {
  program
    .command('list-admins')
    .description('List accounts with admin privileges')
    .option('--json', 'Output as JSON array')
    .action(async (options: { json?: boolean }) => {
      let exitCode = 0;
      try {
        await runListAdmins(options.json === true);
      } catch (error) {
        exitCode = 1;
        console.error('\nList admins failed:');
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        await closePostgresPool();
        process.exit(exitCode);
      }
    });
}
