/**
 * Native SQLite adapter using better-sqlite3-multiple-ciphers.
 * Provides on-disk encrypted SQLite database persistence.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Database as DatabaseType } from 'better-sqlite3';
import Database from 'better-sqlite3-multiple-ciphers';
import type {
  BackupDatabase,
  IndexSchema,
  TableSchema
} from '../backup/types.js';
import { getConfigPaths } from '../config/index.js';

/**
 * Schema for the tearleads database.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER REFERENCES contacts(id),
    type TEXT NOT NULL,
    description TEXT,
    event_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringField(
  value: Record<string, unknown>,
  key: string
): string | null {
  const field = value[key];
  return typeof field === 'string' ? field : null;
}

/**
 * Convert Uint8Array key to hex string for SQLCipher PRAGMA.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Native SQLite adapter with SQLCipher encryption.
 */
export class NativeSqliteAdapter {
  private db: DatabaseType | null = null;
  private dbPath: string;

  constructor() {
    const configPaths = getConfigPaths();
    this.dbPath = configPaths.database;
  }

  /**
   * Initialize a new encrypted database with the given key.
   * Creates the database file and schema.
   */
  async initialize(key: Uint8Array): Promise<void> {
    // Ensure directory exists
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true, mode: 0o700 });

    // Create new database file
    this.db = new Database(this.dbPath);

    // Apply encryption
    this.db.pragma(`key = "x'${bytesToHex(key)}'"`);
    this.db.pragma('cipher_compatibility = 4');

    // Create schema
    this.db.exec(SCHEMA);
  }

  /**
   * Open an existing encrypted database with the given key.
   */
  async open(key: Uint8Array): Promise<void> {
    // Check if database file exists
    try {
      await fs.access(this.dbPath);
    } catch {
      throw new Error('Database file not found');
    }

    // Open existing database
    this.db = new Database(this.dbPath);

    // Apply encryption key
    this.db.pragma(`key = "x'${bytesToHex(key)}'"`);
    this.db.pragma('cipher_compatibility = 4');

    // Verify the key by running a simple query
    try {
      this.db.prepare('SELECT count(*) FROM sqlite_master').get();
    } catch {
      this.db.close();
      this.db = null;
      throw new Error('Invalid encryption key');
    }
  }

  /**
   * Check if the database is currently open.
   */
  isOpen(): boolean {
    return this.db !== null;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Re-key the database with a new encryption key.
   */
  async rekeyDatabase(newKey: Uint8Array): Promise<void> {
    if (!this.db) {
      throw new Error('Database not open');
    }
    this.db.pragma(`rekey = "x'${bytesToHex(newKey)}'"`);
  }

  /**
   * Export the database to a JSON structure for backup.
   */
  exportToJson(): Record<string, unknown[]> {
    if (!this.db) {
      throw new Error('Database not open');
    }

    const result: Record<string, unknown[]> = {};

    // Get all table names
    const tables = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all() as { name: string }[];

    for (const { name } of tables) {
      const rows = this.db.prepare(`SELECT * FROM ${name}`).all();
      result[name] = rows;
    }

    return result;
  }

  /**
   * Export the database to a backup-friendly structure with schema and data.
   */
  exportToBackupDatabase(): BackupDatabase {
    if (!this.db) {
      throw new Error('Database not open');
    }

    const tables = this.db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name"
      )
      .all();

    const tableSchemas: TableSchema[] = [];
    for (const row of tables) {
      if (!isRecord(row)) continue;
      const name = getStringField(row, 'name');
      const sql = getStringField(row, 'sql');
      if (!name || !sql) continue;
      if (name.startsWith('sqlite_') || name === '__drizzle_migrations') {
        continue;
      }
      tableSchemas.push({ name, sql });
    }

    const indexes = this.db
      .prepare(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
      )
      .all();

    const indexSchemas: IndexSchema[] = [];
    for (const row of indexes) {
      if (!isRecord(row)) continue;
      const name = getStringField(row, 'name');
      const tableName = getStringField(row, 'tbl_name');
      const sql = getStringField(row, 'sql');
      if (!name || !tableName || !sql) continue;
      if (name.startsWith('sqlite_')) continue;
      indexSchemas.push({ name, tableName, sql });
    }

    const data: Record<string, unknown[]> = {};
    for (const table of tableSchemas) {
      const rows = this.db.prepare(`SELECT * FROM "${table.name}"`).all();
      data[table.name] = rows;
    }

    return { tables: tableSchemas, indexes: indexSchemas, data };
  }

  /**
   * Import data from a JSON structure (restore from backup).
   */
  importFromJson(data: Record<string, unknown[]>): void {
    if (!this.db) {
      throw new Error('Database not open');
    }

    // Capture db reference for use in transaction callback
    const db = this.db;

    // Start transaction
    const transaction = db.transaction(() => {
      for (const [tableName, rows] of Object.entries(data)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;

        // Clear existing data
        db.prepare(`DELETE FROM ${tableName}`).run();

        // Get column names from first row
        const firstRow = rows[0] as Record<string, unknown>;
        const columns = Object.keys(firstRow);
        const placeholders = columns.map(() => '?').join(', ');
        const insertStmt = db.prepare(
          `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`
        );

        // Insert each row
        for (const row of rows) {
          const rowData = row as Record<string, unknown>;
          const values = columns.map((col) => rowData[col]);
          insertStmt.run(...values);
        }
      }
    });

    transaction();
  }

  /**
   * Import a backup database structure, recreating schema and data.
   */
  importFromBackupDatabase(database: BackupDatabase): void {
    if (!this.db) {
      throw new Error('Database not open');
    }

    const db = this.db;

    const transaction = db.transaction(() => {
      const existingTables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all();

      for (const row of existingTables) {
        if (!isRecord(row)) continue;
        const name = getStringField(row, 'name');
        if (!name) continue;
        db.exec(`DROP TABLE IF EXISTS "${name}"`);
      }

      for (const table of database.tables) {
        db.exec(table.sql);
      }

      for (const [tableName, rows] of Object.entries(database.data)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;

        const firstRow = rows[0];
        if (!isRecord(firstRow)) continue;
        const columns = Object.keys(firstRow);
        if (columns.length === 0) continue;

        const placeholders = columns.map(() => '?').join(', ');
        const insertStmt = db.prepare(
          `INSERT INTO "${tableName}" (${columns.join(', ')}) VALUES (${placeholders})`
        );

        for (const row of rows) {
          if (!isRecord(row)) continue;
          const values = columns.map((col) => row[col]);
          insertStmt.run(...values);
        }
      }

      for (const index of database.indexes) {
        if (index.sql.trim().length > 0) {
          db.exec(index.sql);
        }
      }
    });

    transaction();
  }

  /**
   * Execute a raw SQL query.
   */
  exec(sql: string): void {
    if (!this.db) {
      throw new Error('Database not open');
    }
    this.db.exec(sql);
  }

  /**
   * Get the database file path.
   */
  getPath(): string {
    return this.dbPath;
  }
}
