import { describe, expect, it } from 'vitest';
import {
  createSearchableHelpDocuments,
  getSearchableHelpDocById
} from './helpCatalog';

describe('helpCatalog', () => {
  it('creates searchable help documents with stable ids', () => {
    const docs = createSearchableHelpDocuments(1234);

    expect(docs.length).toBe(5);
    expect(docs.every((doc) => doc.entityType === 'help_doc')).toBe(true);

    const cliDoc = docs.find((doc) => doc.id === 'help-doc:cli');
    expect(cliDoc?.title).toBe('CLI');
    expect(cliDoc?.metadata).toContain('/help/docs/cli');
    expect(cliDoc?.createdAt).toBe(1234);
    expect(cliDoc?.updatedAt).toBe(1234);
  });

  it('looks up help document metadata by id', () => {
    const backupRestoreDoc = getSearchableHelpDocById('help-doc:backupRestore');

    expect(backupRestoreDoc?.title).toBe('Backup & Restore');
    expect(backupRestoreDoc?.path).toBe('/help/docs/backup-restore');
  });

  it('returns null for unknown help document ids', () => {
    expect(getSearchableHelpDocById('help-doc:missing')).toBeNull();
  });
});
