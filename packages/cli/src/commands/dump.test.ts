/**
 * Tests for dump command.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encode } from '../backup/index.js';
import type { BackupDatabase, BackupManifest } from '../backup/types.js';
import { setConfigRoot } from '../config/index.js';
import { clearKey, reset } from '../crypto/key-manager.js';
import { lockDatabase, setupDatabase } from '../db/index.js';
import { runDump } from './dump.js';

describe('dump command', () => {
  let tempDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tearleads-dump-'));
    outputDir = path.join(tempDir, 'output');
    setConfigRoot(tempDir);
    clearKey();
  });

  afterEach(async () => {
    lockDatabase();
    setConfigRoot(null);
    clearKey();
    await reset();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('runDump', () => {
    it('creates output folder structure', async () => {
      await setupDatabase('test-password');
      await runDump(outputDir, {});

      const outputStat = await fs.stat(outputDir);
      expect(outputStat.isDirectory()).toBe(true);

      const tablesStat = await fs.stat(path.join(outputDir, 'tables'));
      expect(tablesStat.isDirectory()).toBe(true);

      const filesStat = await fs.stat(path.join(outputDir, 'files'));
      expect(filesStat.isDirectory()).toBe(true);
    });

    it('creates manifest.json', async () => {
      await setupDatabase('test-password');
      await runDump(outputDir, {});

      const manifestPath = path.join(outputDir, 'manifest.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      expect(manifest).toHaveProperty('createdAt');
      expect(manifest.platform).toBe('cli');
      expect(manifest.appVersion).toBe('cli');
      expect(manifest.exportedTables).toBeInstanceOf(Array);
      expect(manifest.blobCount).toBe(0);
      expect(manifest.blobTotalSize).toBe(0);
    });

    it('creates schema.json with tables and indexes', async () => {
      await setupDatabase('test-password');
      await runDump(outputDir, {});

      const schemaPath = path.join(outputDir, 'schema.json');
      const schemaContent = await fs.readFile(schemaPath, 'utf-8');
      const schema = JSON.parse(schemaContent);

      expect(schema).toHaveProperty('tables');
      expect(schema).toHaveProperty('indexes');
      expect(schema.tables).toBeInstanceOf(Array);
      expect(schema.indexes).toBeInstanceOf(Array);

      // Check table structure
      const contactsTable = schema.tables.find(
        (t: { name: string }) => t.name === 'contacts'
      );
      expect(contactsTable).toBeDefined();
      expect(contactsTable.sql).toContain('CREATE TABLE');
    });

    it('exports tables as JSON arrays', async () => {
      await setupDatabase('test-password');
      await runDump(outputDir, {});

      const contactsPath = path.join(outputDir, 'tables', 'contacts.json');
      const contactsContent = await fs.readFile(contactsPath, 'utf-8');
      const contacts = JSON.parse(contactsContent);

      expect(contacts).toBeInstanceOf(Array);
    });

    it('skips files directory when --no-blobs is used', async () => {
      await setupDatabase('test-password');
      await runDump(outputDir, { blobs: false });

      await expect(fs.access(path.join(outputDir, 'files'))).rejects.toThrow();
    });

    it('overwrites folder without prompt when --force is used', async () => {
      await setupDatabase('test-password');

      // Create existing folder
      await fs.mkdir(outputDir);
      await fs.writeFile(path.join(outputDir, 'existing.txt'), 'test');

      // Run dump with force
      await runDump(outputDir, { force: true });

      // Verify dump completed (existing file should be gone)
      await expect(
        fs.access(path.join(outputDir, 'existing.txt'))
      ).rejects.toThrow();

      // Verify dump files exist
      const manifestStat = await fs.stat(path.join(outputDir, 'manifest.json'));
      expect(manifestStat.isFile()).toBe(true);
    });

    it('dumps from .rbu backup file when --input-file is used', async () => {
      // Create a test backup file
      const backupPath = path.join(tempDir, 'test.rbu');
      const backupPassword = 'backup-password';

      const manifest: BackupManifest = {
        createdAt: new Date().toISOString(),
        platform: 'cli',
        appVersion: 'cli',
        blobCount: 0,
        blobTotalSize: 0
      };

      const database: BackupDatabase = {
        tables: [
          {
            name: 'test_table',
            sql: 'CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)'
          }
        ],
        indexes: [],
        data: {
          test_table: [{ id: 1, name: 'Test Row' }]
        }
      };

      const backupData = await encode({
        password: backupPassword,
        manifest,
        database,
        blobs: [],
        readBlob: async () => {
          throw new Error('No blobs');
        }
      });

      await fs.writeFile(backupPath, backupData);

      // Dump from the backup file (no database setup needed)
      await runDump(outputDir, {
        inputFile: backupPath,
        password: backupPassword
      });

      // Verify output
      const schemaContent = await fs.readFile(
        path.join(outputDir, 'schema.json'),
        'utf-8'
      );
      const schema = JSON.parse(schemaContent);
      expect(schema.tables).toHaveLength(1);
      expect(schema.tables[0].name).toBe('test_table');

      const tableContent = await fs.readFile(
        path.join(outputDir, 'tables', 'test_table.json'),
        'utf-8'
      );
      const tableData = JSON.parse(tableContent);
      expect(tableData).toHaveLength(1);
      expect(tableData[0].name).toBe('Test Row');
    });
  });
});
