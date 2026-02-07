/**
 * Tests for SearchStore
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeSearchStoreForInstance,
  deleteSearchIndexForInstance,
  getSearchStoreForInstance,
  SearchStore
} from './SearchStore';
import { deleteSearchIndexFromStorage } from './searchIndexStorage';
import type { SearchableDocument } from './types';

// Mock the storage module
vi.mock('./searchIndexStorage', () => ({
  isSearchIndexStorageSupported: () => false,
  loadSearchIndexFromStorage: vi.fn().mockResolvedValue(null),
  saveSearchIndexToStorage: vi.fn().mockResolvedValue(undefined),
  deleteSearchIndexFromStorage: vi.fn().mockResolvedValue(undefined)
}));

describe('SearchStore', () => {
  let store: SearchStore;
  const testInstanceId = 'test-instance-123';
  const testEncryptionKey = new Uint8Array(32).fill(1);

  beforeEach(async () => {
    store = new SearchStore();
    await store.initialize(testEncryptionKey, testInstanceId);
  });

  afterEach(async () => {
    await store.close();
  });

  it('should initialize with empty state', () => {
    const state = store.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.documentCount).toBe(0);
    expect(state.isIndexing).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should not reinitialize if already initialized with same instance', async () => {
    const stateBefore = store.getState();
    await store.initialize(testEncryptionKey, testInstanceId);
    const stateAfter = store.getState();

    expect(stateBefore).toEqual(stateAfter);
  });

  describe('upsert', () => {
    it('should add a document and update count', async () => {
      const doc: SearchableDocument = {
        id: 'doc-1',
        entityType: 'contact',
        title: 'John Doe',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await store.upsert(doc);

      const state = store.getState();
      expect(state.documentCount).toBe(1);
    });

    it('should update existing document', async () => {
      const doc: SearchableDocument = {
        id: 'doc-1',
        entityType: 'contact',
        title: 'John Doe',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await store.upsert(doc);

      const updatedDoc: SearchableDocument = {
        ...doc,
        title: 'Jane Doe',
        updatedAt: Date.now()
      };

      await store.upsert(updatedDoc);

      const state = store.getState();
      expect(state.documentCount).toBe(1);

      const { hits: results } = await store.search('Jane');
      expect(results).toHaveLength(1);
      expect(results[0]?.document.title).toBe('Jane Doe');
    });
  });

  describe('upsertBatch', () => {
    it('should add multiple documents', async () => {
      const docs: SearchableDocument[] = [
        {
          id: 'doc-1',
          entityType: 'contact',
          title: 'Alice',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'doc-2',
          entityType: 'contact',
          title: 'Bob',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'doc-3',
          entityType: 'note',
          title: 'Meeting Notes',
          content: 'Discussion about project',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];

      await store.upsertBatch(docs);

      const state = store.getState();
      expect(state.documentCount).toBe(3);
    });
  });

  describe('removeDocument', () => {
    it('should remove a document and update count', async () => {
      const doc: SearchableDocument = {
        id: 'doc-1',
        entityType: 'contact',
        title: 'John Doe',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await store.upsert(doc);
      expect(store.getState().documentCount).toBe(1);

      await store.removeDocument('doc-1');
      expect(store.getState().documentCount).toBe(0);
    });

    it('should handle removing non-existent document gracefully', async () => {
      await expect(store.removeDocument('non-existent')).resolves.not.toThrow();
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      const docs: SearchableDocument[] = [
        {
          id: 'contact-1',
          entityType: 'contact',
          title: 'John Smith',
          metadata: 'john@example.com',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'contact-2',
          entityType: 'contact',
          title: 'Jane Doe',
          metadata: 'jane@example.com',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'note-1',
          entityType: 'note',
          title: 'Meeting with John',
          content: 'Discussed the new project timeline',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];

      await store.upsertBatch(docs);
    });

    it('should find documents by title', async () => {
      const { hits: results } = await store.search('John');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === 'contact-1')).toBe(true);
    });

    it('should find documents by content', async () => {
      const { hits: results } = await store.search('project timeline');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === 'note-1')).toBe(true);
    });

    it('should find documents by metadata', async () => {
      const { hits: results } = await store.search('jane@example.com');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === 'contact-2')).toBe(true);
    });

    it('should filter by entity type', async () => {
      const { hits: results } = await store.search('John', {
        entityTypes: ['note']
      });

      expect(results.every((r) => r.entityType === 'note')).toBe(true);
    });

    it('should respect limit option', async () => {
      const { hits: results } = await store.search('example.com', { limit: 1 });

      expect(results).toHaveLength(1);
    });

    it('should return empty array for empty query', async () => {
      const { hits: results } = await store.search('');

      expect(results).toHaveLength(0);
    });

    it('should return empty array for whitespace query', async () => {
      const { hits: results } = await store.search('   ');

      expect(results).toHaveLength(0);
    });
  });

  describe('subscribe', () => {
    it('should notify listeners on state changes', async () => {
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);

      const doc: SearchableDocument = {
        id: 'doc-1',
        entityType: 'contact',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await store.upsert(doc);

      expect(listener).toHaveBeenCalled();

      unsubscribe();
    });

    it('should stop notifying after unsubscribe', async () => {
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);

      unsubscribe();

      const doc: SearchableDocument = {
        id: 'doc-1',
        entityType: 'contact',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await store.upsert(doc);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('deleteStorageForInstance', () => {
    it('should call deleteSearchIndexFromStorage', async () => {
      await store.deleteStorageForInstance('some-instance');

      expect(deleteSearchIndexFromStorage).toHaveBeenCalledWith(
        'some-instance'
      );
    });
  });

  describe('rebuildFromDatabase', () => {
    it('should replace all documents', async () => {
      // Add initial documents
      await store.upsert({
        id: 'old-1',
        entityType: 'contact',
        title: 'Old Contact',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      expect(store.getState().documentCount).toBe(1);

      // Rebuild with new documents
      const newDocs: SearchableDocument[] = [
        {
          id: 'new-1',
          entityType: 'note',
          title: 'New Note 1',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'new-2',
          entityType: 'note',
          title: 'New Note 2',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];

      await store.rebuildFromDatabase(async () => newDocs);

      expect(store.getState().documentCount).toBe(2);

      // Old document should not be findable
      const { hits: oldResults } = await store.search('Old Contact');
      expect(oldResults).toHaveLength(0);

      // New documents should be findable
      const { hits: newResults } = await store.search('New Note');
      expect(newResults).toHaveLength(2);
    });

    it('should set isIndexing during rebuild', async () => {
      let isIndexingDuringRebuild = false;

      await store.rebuildFromDatabase(async () => {
        isIndexingDuringRebuild = store.getState().isIndexing;
        return [];
      });

      expect(isIndexingDuringRebuild).toBe(true);
      expect(store.getState().isIndexing).toBe(false);
    });
  });
});

describe('getSearchStoreForInstance', () => {
  afterEach(async () => {
    await closeSearchStoreForInstance('instance-1');
    await closeSearchStoreForInstance('instance-2');
  });

  it('should return same instance for same instanceId', () => {
    const store1 = getSearchStoreForInstance('instance-1');
    const store2 = getSearchStoreForInstance('instance-1');

    expect(store1).toBe(store2);
  });

  it('should return different instances for different instanceIds', () => {
    const store1 = getSearchStoreForInstance('instance-1');
    const store2 = getSearchStoreForInstance('instance-2');

    expect(store1).not.toBe(store2);
  });
});

describe('closeSearchStoreForInstance', () => {
  it('should close and remove instance', async () => {
    const store1 = getSearchStoreForInstance('close-test');
    await store1.initialize(new Uint8Array(32), 'close-test');

    await closeSearchStoreForInstance('close-test');

    // Getting it again should return a new (uninitialized) instance
    const store2 = getSearchStoreForInstance('close-test');
    expect(store2.getState().isInitialized).toBe(false);
  });
});

describe('deleteSearchIndexForInstance', () => {
  it('should close store and delete storage for existing instance', async () => {
    const store = getSearchStoreForInstance('delete-test');
    await store.initialize(new Uint8Array(32), 'delete-test');

    await deleteSearchIndexForInstance('delete-test');

    // Getting it again should return a new (uninitialized) instance
    const store2 = getSearchStoreForInstance('delete-test');
    expect(store2.getState().isInitialized).toBe(false);

    // Clean up
    await closeSearchStoreForInstance('delete-test');
  });

  it('should delete storage for non-existing instance', async () => {
    // Call delete on instance that was never created
    await deleteSearchIndexForInstance('non-existent-instance');

    // Should call deleteSearchIndexFromStorage directly
    expect(deleteSearchIndexFromStorage).toHaveBeenCalledWith(
      'non-existent-instance'
    );
  });
});
