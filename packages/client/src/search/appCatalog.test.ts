import { describe, expect, it } from 'vitest';
import {
  createSearchableAppDocuments,
  getSearchableAppById,
  toAppSearchId
} from './appCatalog';

describe('appCatalog', () => {
  it('creates searchable app documents with stable ids', () => {
    const docs = createSearchableAppDocuments(1234);

    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((doc) => doc.entityType === 'app')).toBe(true);

    const notesDoc = docs.find((doc) => doc.id === toAppSearchId('notes'));
    expect(notesDoc?.title).toBe('Notes');
    expect(notesDoc?.metadata).toContain('/notes');
    expect(notesDoc?.createdAt).toBe(1234);
    expect(notesDoc?.updatedAt).toBe(1234);
  });

  it('looks up app definitions by id', () => {
    const app = getSearchableAppById(toAppSearchId('chat'));
    expect(app?.windowType).toBe('chat');
    expect(app?.path).toBe('/ai');

    expect(getSearchableAppById('app:missing')).toBeNull();
  });
});
