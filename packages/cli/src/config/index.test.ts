import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearConfig,
  clearSession,
  configExists,
  ensureConfigDir,
  getConfigPaths,
  hasSession,
  isDatabaseSetUp,
  setConfigRoot
} from './index.js';

describe('config', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tearleads-test-'));
    setConfigRoot(tempDir);
  });

  afterEach(async () => {
    setConfigRoot(null);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('getConfigPaths', () => {
    it('returns paths relative to custom root', () => {
      const paths = getConfigPaths();
      expect(paths.root).toBe(tempDir);
      expect(paths.database).toBe(path.join(tempDir, 'tearleads.db'));
      expect(paths.keyData).toBe(path.join(tempDir, 'keydata.json'));
      expect(paths.session).toBe(path.join(tempDir, '.session'));
    });

    it('returns paths relative to home directory when no custom root', () => {
      setConfigRoot(null);
      const paths = getConfigPaths();
      expect(paths.root).toBe(path.join(os.homedir(), '.tearleads'));
      setConfigRoot(tempDir);
    });
  });

  describe('ensureConfigDir', () => {
    it('creates the config directory if it does not exist', async () => {
      const newDir = path.join(tempDir, 'nested', 'dir');
      setConfigRoot(newDir);

      await ensureConfigDir();

      const stat = await fs.stat(newDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('does not fail if directory already exists', async () => {
      await ensureConfigDir();
      await ensureConfigDir();

      const stat = await fs.stat(tempDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('configExists', () => {
    it('returns false if config directory does not exist', async () => {
      const nonExistent = path.join(tempDir, 'nonexistent');
      setConfigRoot(nonExistent);

      const exists = await configExists();
      expect(exists).toBe(false);
    });

    it('returns true if config directory exists', async () => {
      await ensureConfigDir();

      const exists = await configExists();
      expect(exists).toBe(true);
    });
  });

  describe('isDatabaseSetUp', () => {
    it('returns false if keydata.json does not exist', async () => {
      await ensureConfigDir();

      const isSetUp = await isDatabaseSetUp();
      expect(isSetUp).toBe(false);
    });

    it('returns true if keydata.json exists', async () => {
      await ensureConfigDir();
      const paths = getConfigPaths();
      await fs.writeFile(paths.keyData, '{}');

      const isSetUp = await isDatabaseSetUp();
      expect(isSetUp).toBe(true);
    });
  });

  describe('hasSession', () => {
    it('returns false if session file does not exist', async () => {
      await ensureConfigDir();

      const exists = await hasSession();
      expect(exists).toBe(false);
    });

    it('returns true if session file exists', async () => {
      await ensureConfigDir();
      const paths = getConfigPaths();
      await fs.writeFile(paths.session, '{}');

      const exists = await hasSession();
      expect(exists).toBe(true);
    });
  });

  describe('clearSession', () => {
    it('removes the session file if it exists', async () => {
      await ensureConfigDir();
      const paths = getConfigPaths();
      await fs.writeFile(paths.session, '{}');

      await clearSession();

      const exists = await hasSession();
      expect(exists).toBe(false);
    });

    it('does not fail if session file does not exist', async () => {
      await ensureConfigDir();

      await expect(clearSession()).resolves.not.toThrow();
    });
  });

  describe('clearConfig', () => {
    it('removes the entire config directory', async () => {
      await ensureConfigDir();
      const paths = getConfigPaths();
      await fs.writeFile(paths.keyData, '{}');
      await fs.writeFile(paths.session, '{}');

      await clearConfig();

      const exists = await configExists();
      expect(exists).toBe(false);
    });

    it('does not fail if config directory does not exist', async () => {
      const nonExistent = path.join(tempDir, 'nonexistent');
      setConfigRoot(nonExistent);

      await expect(clearConfig()).resolves.not.toThrow();
    });
  });
});
