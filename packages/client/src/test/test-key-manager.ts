/**
 * Test key manager for Vitest integration tests.
 * Provides deterministic keys without requiring IndexedDB or crypto derivation.
 */

/**
 * Deterministic 32-byte test key (for AES-256 / ChaCha20).
 * This is used for all tests to ensure reproducibility.
 */
const TEST_KEY = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
  0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19,
  0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f
]);

/**
 * Simplified key manager for testing.
 * Implements the same interface as KeyManager but uses in-memory storage
 * and deterministic keys.
 */
export class TestKeyManager {
  private isSetUp = false;
  private currentKey: Uint8Array | null = null;
  private sessionPersisted = false;

  async initialize(): Promise<void> {
    // No-op for tests
  }

  /**
   * Check if a database key has been set up.
   */
  async hasExistingKey(): Promise<boolean> {
    return this.isSetUp;
  }

  /**
   * Set up a new encryption key from a password.
   * In tests, we ignore the password and use the deterministic test key.
   */
  async setupNewKey(_password: string): Promise<Uint8Array> {
    this.isSetUp = true;
    this.currentKey = new Uint8Array(TEST_KEY);
    return this.currentKey;
  }

  /**
   * Unlock an existing database with a password.
   * In tests, any password works as long as the database is set up.
   */
  async unlockWithPassword(_password: string): Promise<Uint8Array | null> {
    if (!this.isSetUp) {
      throw new Error('No existing key found. Use setupNewKey instead.');
    }

    this.currentKey = new Uint8Array(TEST_KEY);
    return this.currentKey;
  }

  /**
   * Change the encryption password.
   * In tests, this is a no-op that returns the same key.
   */
  async changePassword(
    _oldPassword: string,
    _newPassword: string
  ): Promise<{ oldKey: Uint8Array; newKey: Uint8Array } | null> {
    if (!this.isSetUp) {
      return null;
    }

    const oldKey = new Uint8Array(TEST_KEY);
    const newKey = new Uint8Array(TEST_KEY);
    return { oldKey, newKey };
  }

  /**
   * Get the current key (must be unlocked first).
   */
  getCurrentKey(): Uint8Array | null {
    return this.currentKey;
  }

  /**
   * Clear the current key from memory.
   */
  clearKey(): void {
    this.currentKey = null;
  }

  /**
   * Reset everything.
   */
  async reset(): Promise<void> {
    this.clearKey();
    this.isSetUp = false;
    this.sessionPersisted = false;
  }

  /**
   * Persist the current key for session restoration.
   * In tests, just sets a flag.
   */
  async persistSession(): Promise<boolean> {
    if (!this.currentKey) return false;
    this.sessionPersisted = true;
    return true;
  }

  /**
   * Check if a persisted session exists.
   */
  async hasPersistedSession(): Promise<boolean> {
    return this.sessionPersisted && this.isSetUp;
  }

  /**
   * Restore a persisted session.
   */
  async restoreSession(): Promise<Uint8Array | null> {
    if (!this.sessionPersisted || !this.isSetUp) {
      return null;
    }

    this.currentKey = new Uint8Array(TEST_KEY);
    return this.currentKey;
  }

  /**
   * Clear any persisted session data.
   */
  async clearPersistedSession(): Promise<void> {
    this.sessionPersisted = false;
  }

  // Test-specific methods

  /**
   * Force the key manager into a set up state without calling setupNewKey.
   * Useful for tests that want to start with an "existing" database.
   */
  setIsSetUp(value: boolean): void {
    this.isSetUp = value;
  }

  /**
   * Get the deterministic test key directly.
   */
  static getTestKey(): Uint8Array {
    return new Uint8Array(TEST_KEY);
  }
}

// Singleton instance for tests
let testKeyManagerInstance: TestKeyManager | null = null;

/**
 * Get the test key manager singleton.
 * Creates a new instance if one doesn't exist.
 */
export function getTestKeyManager(): TestKeyManager {
  if (!testKeyManagerInstance) {
    testKeyManagerInstance = new TestKeyManager();
  }
  return testKeyManagerInstance;
}

/**
 * Reset the test key manager singleton.
 * Call this in beforeEach to ensure test isolation.
 */
export function resetTestKeyManager(): void {
  if (testKeyManagerInstance) {
    testKeyManagerInstance.reset();
  }
  testKeyManagerInstance = null;
}

/**
 * Create a fresh test key manager (not the singleton).
 * Useful when you need an isolated instance.
 */
export function createTestKeyManager(): TestKeyManager {
  return new TestKeyManager();
}
