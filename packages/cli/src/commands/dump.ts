/**
 * Dump command - Export database to unencrypted JSON files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { decode } from '../backup/index.js';
import type { BackupDatabase } from '../backup/types.js';
import { hasPersistedSession } from '../crypto/key-manager.js';
import {
  exportBackupDatabase,
  isDatabaseSetUp,
  isDatabaseUnlocked,
  restoreDatabaseSession
} from '../db/index.js';
import { promptConfirm, promptPassword } from '../utils/prompt.js';

interface DumpOptions {
  force?: boolean;
  blobs?: boolean;
  inputFile?: string;
  password?: string;
}

export async function runDump(
  folder: string,
  options: DumpOptions
): Promise<void> {
  let database: BackupDatabase;

  if (options.inputFile) {
    // Dump from .rbu backup file
    const filePath = path.resolve(options.inputFile);
    try {
      await fs.access(filePath);
    } catch {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }

    const password = options.password
      ? options.password
      : await promptPassword('Backup password: ');

    const backupData = await fs.readFile(filePath);
    try {
      const decoded = await decode({
        data: new Uint8Array(backupData),
        password
      });
      database = decoded.database;

      if (decoded.blobs.length > 0) {
        console.warn(
          `Warning: backup contains ${decoded.blobs.length} blobs that will be ignored.`
        );
      }
    } catch (err) {
      console.error(
        err instanceof Error ? err.message : 'Failed to decode backup file.'
      );
      process.exit(1);
    }
  } else {
    // Dump from live database
    if (!(await isDatabaseSetUp())) {
      console.error('Database not set up. Run "tearleads setup" first.');
      process.exit(1);
    }

    if (!isDatabaseUnlocked()) {
      if (await hasPersistedSession()) {
        const restored = await restoreDatabaseSession();
        if (!restored) {
          console.error('Session expired. Run "tearleads unlock" first.');
          process.exit(1);
        }
      } else {
        console.error('Database not unlocked. Run "tearleads unlock" first.');
        process.exit(1);
      }
    }

    database = exportBackupDatabase();
  }

  const outputPath = path.resolve(folder);

  try {
    const stat = await fs.stat(outputPath);
    if (stat.isDirectory()) {
      if (!options.force) {
        const confirmed = await promptConfirm(
          `Folder ${outputPath} exists. Overwrite? (y/n): `
        );
        if (!confirmed) {
          console.log('Dump cancelled.');
          return;
        }
      }
      await fs.rm(outputPath, { recursive: true });
    } else {
      console.error(`${outputPath} exists and is not a directory.`);
      process.exit(1);
    }
  } catch {
    // Folder doesn't exist, which is fine
  }

  await fs.mkdir(outputPath, { recursive: true });
  await fs.mkdir(path.join(outputPath, 'tables'), { recursive: true });
  if (options.blobs !== false) {
    await fs.mkdir(path.join(outputPath, 'files'), { recursive: true });
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    platform: 'cli' as const,
    appVersion: 'cli',
    exportedTables: database.tables.map((t) => t.name),
    blobCount: 0,
    blobTotalSize: 0
  };
  await fs.writeFile(
    path.join(outputPath, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  const schema = {
    tables: database.tables,
    indexes: database.indexes
  };
  await fs.writeFile(
    path.join(outputPath, 'schema.json'),
    JSON.stringify(schema, null, 2)
  );

  for (const table of database.tables) {
    const tableData = database.data[table.name] ?? [];
    await fs.writeFile(
      path.join(outputPath, 'tables', `${table.name}.json`),
      JSON.stringify(tableData, null, 2)
    );
  }

  console.log(`Database dumped to ${outputPath}`);
  console.log(`  Tables: ${database.tables.length}`);
}

export const dumpCommand = new Command('dump')
  .description('Export database to unencrypted JSON files')
  .argument('<folder>', 'Output folder path')
  .option(
    '-f, --input-file <file>',
    'Read from .rbu backup file instead of live database'
  )
  .option(
    '-p, --password <password>',
    'Backup file password (used with --input-file)'
  )
  .option('--force', 'Overwrite existing folder without confirmation')
  .option('--no-blobs', 'Skip files directory')
  .action(runDump);
