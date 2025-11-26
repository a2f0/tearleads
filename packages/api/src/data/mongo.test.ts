import { MongoClient } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMongoInstance, initMongo, MongoDB } from './mongo.js';

interface MockClient {
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  db: ReturnType<typeof vi.fn>;
}

// Mock the mongodb module
vi.mock('mongodb', () => {
  const mockDb = {
    collection: vi.fn()
  };

  const MockClient = vi.fn(function (this: MockClient) {
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.close = vi.fn().mockResolvedValue(undefined);
    this.db = vi.fn().mockReturnValue(mockDb);
  });

  return {
    MongoClient: MockClient,
    type: {}
  };
});

describe('MongoDB', () => {
  let mongodb: MongoDB;
  const testUri = 'mongodb://localhost:27017';
  const testDbName = 'test-db';

  beforeEach(() => {
    vi.clearAllMocks();
    mongodb = new MongoDB(testUri, testDbName);
  });

  describe('constructor', () => {
    it('should create a MongoDB instance with uri and dbName', () => {
      expect(mongodb).toBeInstanceOf(MongoDB);
    });
  });

  describe('connect', () => {
    it('should connect to MongoDB successfully', async () => {
      await mongodb.connect();

      expect(MongoClient).toHaveBeenCalledWith(testUri, {
        maxPoolSize: 10,
        minPoolSize: 5
      });
      expect(mongodb.isConnected()).toBe(true);
    });

    it('should not connect if already connected', async () => {
      await mongodb.connect();
      const firstCallCount = (
        MongoClient as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.length;

      await mongodb.connect();
      const secondCallCount = (
        MongoClient as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount);
    });

    it('should log connection message', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await mongodb.connect();

      expect(consoleSpy).toHaveBeenCalledWith(
        `Connected to MongoDB database: ${testDbName}`
      );

      consoleSpy.mockRestore();
    });
  });

  describe('disconnect', () => {
    it('should disconnect from MongoDB successfully', async () => {
      await mongodb.connect();
      // biome-ignore lint/suspicious/noExplicitAny: accessing private property for testing
      const mockClient = (mongodb as any).client;

      await mongodb.disconnect();

      expect(mockClient.close).toHaveBeenCalled();
      expect(mongodb.isConnected()).toBe(false);
    });

    it('should log disconnection message', async () => {
      await mongodb.connect();
      const consoleSpy = vi.spyOn(console, 'log');

      await mongodb.disconnect();

      expect(consoleSpy).toHaveBeenCalledWith('Disconnected from MongoDB');

      consoleSpy.mockRestore();
    });

    it('should do nothing if not connected', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await mongodb.disconnect();

      expect(consoleSpy).not.toHaveBeenCalledWith('Disconnected from MongoDB');

      consoleSpy.mockRestore();
    });
  });

  describe('getDb', () => {
    it('should return database instance when connected', async () => {
      await mongodb.connect();

      const db = mongodb.getDb();

      expect(db).toBeDefined();
    });

    it('should throw error when not connected', () => {
      expect(() => mongodb.getDb()).toThrow(
        'Database not connected. Call connect() first.'
      );
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(mongodb.isConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      await mongodb.connect();

      expect(mongodb.isConnected()).toBe(true);
    });

    it('should return false after disconnecting', async () => {
      await mongodb.connect();
      await mongodb.disconnect();

      expect(mongodb.isConnected()).toBe(false);
    });
  });

  describe('getCollection', () => {
    it('should return a collection when connected', async () => {
      await mongodb.connect();
      const mockCollection = { name: 'test-collection' };
      // biome-ignore lint/suspicious/noExplicitAny: mocking db.collection for testing
      const db = mongodb.getDb() as any;
      db.collection.mockReturnValue(mockCollection);

      const collection = mongodb.getCollection('users');

      expect(db.collection).toHaveBeenCalledWith('users');
      expect(collection).toBe(mockCollection);
    });

    it('should throw error when not connected', () => {
      expect(() => mongodb.getCollection('users')).toThrow(
        'Database not connected. Call connect() first.'
      );
    });
  });
});

describe('getMongoInstance', () => {
  it('should create a new instance with uri and dbName', () => {
    const instance = getMongoInstance('mongodb://localhost:27017', 'test-db');

    expect(instance).toBeInstanceOf(MongoDB);
  });

  it('should return the same instance on subsequent calls', () => {
    const instance1 = getMongoInstance('mongodb://localhost:27017', 'test-db');
    const instance2 = getMongoInstance();

    expect(instance1).toBe(instance2);
  });
});

describe('initMongo', () => {
  it('should initialize and connect to MongoDB', async () => {
    const uri = 'mongodb://localhost:27017';
    const dbName = 'test-db';

    const instance = await initMongo(uri, dbName);

    expect(instance).toBeInstanceOf(MongoDB);
    expect(instance.isConnected()).toBe(true);
  });

  it('should return the same connected instance', async () => {
    const instance = getMongoInstance();

    expect(instance).toBeInstanceOf(MongoDB);
    expect(instance.isConnected()).toBe(true);
  });
});
