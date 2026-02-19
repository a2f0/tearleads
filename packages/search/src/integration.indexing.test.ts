/**
 * Tests for search indexing helpers
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  indexDocument,
  indexDocuments,
  indexEntity,
  removeFromIndex
} from './integration';
import type { SearchableDocument } from './types';

const getSearchStoreForInstanceMock = vi.hoisted(() => vi.fn());
vi.mock('./SearchStore', () => ({
  getSearchStoreForInstance: getSearchStoreForInstanceMock
}));

describe('indexDocument', () => {
  const mockUpsert = vi.fn();
  const mockGetState = vi.fn();
  const mockStore = {
    getState: mockGetState,
    upsert: mockUpsert
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getSearchStoreForInstanceMock.mockReturnValue(mockStore);
  });

  it('should no-op when instanceId is null', async () => {
    await indexDocument(null, {
      id: 'doc-1',
      entityType: 'contact',
      title: 'Test',
      createdAt: 1000,
      updatedAt: 1000
    });

    expect(getSearchStoreForInstanceMock).not.toHaveBeenCalled();
  });

  it('should no-op when store is not initialized', async () => {
    mockGetState.mockReturnValue({ isInitialized: false });

    await indexDocument('instance-1', {
      id: 'doc-1',
      entityType: 'contact',
      title: 'Test',
      createdAt: 1000,
      updatedAt: 1000
    });

    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('should upsert document when store is initialized', async () => {
    mockGetState.mockReturnValue({ isInitialized: true });
    const doc: SearchableDocument = {
      id: 'doc-1',
      entityType: 'contact',
      title: 'Test',
      createdAt: 1000,
      updatedAt: 1000
    };

    await indexDocument('instance-1', doc);

    expect(mockUpsert).toHaveBeenCalledWith(doc);
  });
});

describe('indexDocuments', () => {
  const mockUpsertBatch = vi.fn();
  const mockGetState = vi.fn();
  const mockStore = {
    getState: mockGetState,
    upsertBatch: mockUpsertBatch
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getSearchStoreForInstanceMock.mockReturnValue(mockStore);
  });

  it('should no-op when instanceId is null', async () => {
    await indexDocuments(null, []);

    expect(getSearchStoreForInstanceMock).not.toHaveBeenCalled();
  });

  it('should no-op when docs array is empty', async () => {
    await indexDocuments('instance-1', []);

    expect(getSearchStoreForInstanceMock).not.toHaveBeenCalled();
  });

  it('should no-op when store is not initialized', async () => {
    mockGetState.mockReturnValue({ isInitialized: false });

    await indexDocuments('instance-1', [
      {
        id: 'doc-1',
        entityType: 'contact',
        title: 'Test',
        createdAt: 1,
        updatedAt: 1
      }
    ]);

    expect(mockUpsertBatch).not.toHaveBeenCalled();
  });

  it('should upsert batch when store is initialized', async () => {
    mockGetState.mockReturnValue({ isInitialized: true });
    const docs: SearchableDocument[] = [
      {
        id: 'doc-1',
        entityType: 'contact',
        title: 'Test 1',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'doc-2',
        entityType: 'note',
        title: 'Test 2',
        createdAt: 2,
        updatedAt: 2
      }
    ];

    await indexDocuments('instance-1', docs);

    expect(mockUpsertBatch).toHaveBeenCalledWith(docs);
  });
});

describe('removeFromIndex', () => {
  const mockRemoveDocument = vi.fn();
  const mockGetState = vi.fn();
  const mockStore = {
    getState: mockGetState,
    removeDocument: mockRemoveDocument
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getSearchStoreForInstanceMock.mockReturnValue(mockStore);
  });

  it('should no-op when instanceId is null', async () => {
    await removeFromIndex(null, 'doc-1');

    expect(getSearchStoreForInstanceMock).not.toHaveBeenCalled();
  });

  it('should no-op when store is not initialized', async () => {
    mockGetState.mockReturnValue({ isInitialized: false });

    await removeFromIndex('instance-1', 'doc-1');

    expect(mockRemoveDocument).not.toHaveBeenCalled();
  });

  it('should remove document when store is initialized', async () => {
    mockGetState.mockReturnValue({ isInitialized: true });

    await removeFromIndex('instance-1', 'doc-1');

    expect(mockRemoveDocument).toHaveBeenCalledWith('doc-1');
  });
});

describe('indexEntity', () => {
  const mockUpsert = vi.fn();
  const mockGetState = vi.fn();
  const mockStore = {
    getState: mockGetState,
    upsert: mockUpsert
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getSearchStoreForInstanceMock.mockReturnValue(mockStore);
  });

  it('should index a contact entity', async () => {
    mockGetState.mockReturnValue({ isInitialized: true });

    await indexEntity('instance-1', {
      type: 'contact',
      id: 'contact-1',
      firstName: 'John',
      lastName: 'Doe'
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'contact-1',
        entityType: 'contact',
        title: 'John Doe'
      })
    );
  });
});
