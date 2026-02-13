/**
 * Integration helpers for indexing documents from Context Providers.
 * These functions simplify adding entities to the search index.
 */

import { getSearchStoreForInstance } from './SearchStore';
import type { SearchableDocument } from './types';

/**
 * Index a document in the search store for the given instance.
 * No-op if instanceId is null (database not unlocked).
 */
export async function indexDocument(
  instanceId: string | null,
  doc: SearchableDocument
): Promise<void> {
  if (!instanceId) {
    return;
  }

  const store = getSearchStoreForInstance(instanceId);
  const state = store.getState();

  if (!state.isInitialized) {
    return;
  }

  await store.upsert(doc);
}

/**
 * Index multiple documents in batch.
 * More efficient for bulk operations.
 */
export async function indexDocuments(
  instanceId: string | null,
  docs: SearchableDocument[]
): Promise<void> {
  if (!instanceId || docs.length === 0) {
    return;
  }

  const store = getSearchStoreForInstance(instanceId);
  const state = store.getState();

  if (!state.isInitialized) {
    return;
  }

  await store.upsertBatch(docs);
}

/**
 * Remove a document from the search index.
 * No-op if instanceId is null.
 */
export async function removeFromIndex(
  instanceId: string | null,
  id: string
): Promise<void> {
  if (!instanceId) {
    return;
  }

  const store = getSearchStoreForInstance(instanceId);
  const state = store.getState();

  if (!state.isInitialized) {
    return;
  }

  await store.removeDocument(id);
}

// --- Factory functions to create SearchableDocuments ---

/**
 * Create a searchable document for a contact.
 */
export function createContactDocument(
  id: string,
  firstName: string | null,
  lastName: string | null,
  email?: string | null,
  phone?: string | null,
  createdAt?: number,
  updatedAt?: number
): SearchableDocument {
  const now = Date.now();
  const nameParts = [firstName, lastName].filter(Boolean);
  const title = nameParts.length > 0 ? nameParts.join(' ') : 'Unknown';

  const metadataParts: string[] = [];
  if (email) metadataParts.push(email);
  if (phone) metadataParts.push(phone);

  const doc: SearchableDocument = {
    id,
    entityType: 'contact',
    title,
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now
  };

  if (metadataParts.length > 0) {
    doc.metadata = metadataParts.join(' ');
  }

  return doc;
}

/**
 * Create a searchable document for a note.
 */
export function createNoteDocument(
  id: string,
  title: string,
  content?: string | null,
  createdAt?: number,
  updatedAt?: number
): SearchableDocument {
  const now = Date.now();

  const doc: SearchableDocument = {
    id,
    entityType: 'note',
    title: title || 'Untitled',
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now
  };

  if (content) {
    doc.content = content;
  }

  return doc;
}

/**
 * Create a searchable document for an email.
 */
export function createEmailDocument(
  id: string,
  subject: string | null,
  body?: string | null,
  from?: string | null,
  to?: string | null,
  createdAt?: number,
  updatedAt?: number
): SearchableDocument {
  const now = Date.now();

  const metadataParts: string[] = [];
  if (from) metadataParts.push(`from:${from}`);
  if (to) metadataParts.push(`to:${to}`);

  const doc: SearchableDocument = {
    id,
    entityType: 'email',
    title: subject || '(No Subject)',
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now
  };

  if (body) {
    doc.content = body;
  }

  if (metadataParts.length > 0) {
    doc.metadata = metadataParts.join(' ');
  }

  return doc;
}

/**
 * Create a searchable document for a playlist.
 */
export function createPlaylistDocument(
  id: string,
  name: string,
  description?: string | null,
  createdAt?: number,
  updatedAt?: number
): SearchableDocument {
  const now = Date.now();

  const doc: SearchableDocument = {
    id,
    entityType: 'playlist',
    title: name || 'Untitled Playlist',
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now
  };

  if (description) {
    doc.content = description;
  }

  return doc;
}

/**
 * Create a searchable document for an album.
 */
export function createAlbumDocument(
  id: string,
  name: string,
  artist?: string | null,
  createdAt?: number,
  updatedAt?: number
): SearchableDocument {
  const now = Date.now();

  const doc: SearchableDocument = {
    id,
    entityType: 'album',
    title: name || 'Unknown Album',
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now
  };

  if (artist) {
    doc.metadata = artist;
  }

  return doc;
}

/**
 * Create a searchable document for a file.
 */
export function createFileDocument(
  id: string,
  name: string,
  mimeType?: string | null,
  createdAt?: number,
  updatedAt?: number
): SearchableDocument {
  const now = Date.now();

  const doc: SearchableDocument = {
    id,
    entityType: 'file',
    title: name || 'Unnamed File',
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now
  };

  if (mimeType) {
    doc.metadata = mimeType;
  }

  return doc;
}

/**
 * Create a searchable document for an AI conversation.
 */
export function createAIConversationDocument(
  id: string,
  title: string,
  preview?: string | null,
  createdAt?: number,
  updatedAt?: number
): SearchableDocument {
  const now = Date.now();

  const doc: SearchableDocument = {
    id,
    entityType: 'ai_conversation',
    title: title || 'AI Conversation',
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now
  };

  if (preview) {
    doc.content = preview;
  }

  return doc;
}

// --- Helper type for entity-specific indexing ---

export type IndexableEntity =
  | {
      type: 'contact';
      id: string;
      firstName: string | null;
      lastName: string | null;
      email?: string | null;
      phone?: string | null;
      createdAt?: number;
      updatedAt?: number;
    }
  | {
      type: 'note';
      id: string;
      title: string;
      content?: string | null;
      createdAt?: number;
      updatedAt?: number;
    }
  | {
      type: 'email';
      id: string;
      subject: string | null;
      body?: string | null;
      from?: string | null;
      to?: string | null;
      createdAt?: number;
      updatedAt?: number;
    }
  | {
      type: 'playlist';
      id: string;
      name: string;
      description?: string | null;
      createdAt?: number;
      updatedAt?: number;
    }
  | {
      type: 'album';
      id: string;
      name: string;
      artist?: string | null;
      createdAt?: number;
      updatedAt?: number;
    }
  | {
      type: 'file';
      id: string;
      name: string;
      mimeType?: string | null;
      createdAt?: number;
      updatedAt?: number;
    }
  | {
      type: 'ai_conversation';
      id: string;
      title: string;
      preview?: string | null;
      createdAt?: number;
      updatedAt?: number;
    };

/**
 * Create a SearchableDocument from an IndexableEntity.
 * Provides a unified API for indexing different entity types.
 */
export function createDocumentFromEntity(
  entity: IndexableEntity
): SearchableDocument {
  switch (entity.type) {
    case 'contact':
      return createContactDocument(
        entity.id,
        entity.firstName,
        entity.lastName,
        entity.email,
        entity.phone,
        entity.createdAt,
        entity.updatedAt
      );
    case 'note':
      return createNoteDocument(
        entity.id,
        entity.title,
        entity.content,
        entity.createdAt,
        entity.updatedAt
      );
    case 'email':
      return createEmailDocument(
        entity.id,
        entity.subject,
        entity.body,
        entity.from,
        entity.to,
        entity.createdAt,
        entity.updatedAt
      );
    case 'playlist':
      return createPlaylistDocument(
        entity.id,
        entity.name,
        entity.description,
        entity.createdAt,
        entity.updatedAt
      );
    case 'album':
      return createAlbumDocument(
        entity.id,
        entity.name,
        entity.artist,
        entity.createdAt,
        entity.updatedAt
      );
    case 'file':
      return createFileDocument(
        entity.id,
        entity.name,
        entity.mimeType,
        entity.createdAt,
        entity.updatedAt
      );
    case 'ai_conversation':
      return createAIConversationDocument(
        entity.id,
        entity.title,
        entity.preview,
        entity.createdAt,
        entity.updatedAt
      );
  }
}

/**
 * Index an entity directly using the unified API.
 */
export async function indexEntity(
  instanceId: string | null,
  entity: IndexableEntity
): Promise<void> {
  const doc = createDocumentFromEntity(entity);
  await indexDocument(instanceId, doc);
}
