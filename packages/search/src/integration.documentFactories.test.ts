/**
 * Tests for search document creation helpers
 */

import { describe, expect, it } from 'vitest';
import {
  createAIConversationDocument,
  createAlbumDocument,
  createContactDocument,
  createDocumentFromEntity,
  createEmailDocument,
  createFileDocument,
  createNoteDocument,
  createPlaylistDocument
} from './integration';

describe('createContactDocument', () => {
  it('should create document with full name', () => {
    const doc = createContactDocument('id-1', 'John', 'Doe');

    expect(doc.id).toBe('id-1');
    expect(doc.entityType).toBe('contact');
    expect(doc.title).toBe('John Doe');
  });

  it('should handle first name only', () => {
    const doc = createContactDocument('id-1', 'John', null);

    expect(doc.title).toBe('John');
  });

  it('should handle last name only', () => {
    const doc = createContactDocument('id-1', null, 'Doe');

    expect(doc.title).toBe('Doe');
  });

  it('should handle no name', () => {
    const doc = createContactDocument('id-1', null, null);

    expect(doc.title).toBe('Unknown');
  });

  it('should include email in metadata', () => {
    const doc = createContactDocument(
      'id-1',
      'John',
      'Doe',
      'john@example.com'
    );

    expect(doc.metadata).toBe('john@example.com');
  });

  it('should include phone in metadata', () => {
    const doc = createContactDocument(
      'id-1',
      'John',
      'Doe',
      null,
      '+1234567890'
    );

    expect(doc.metadata).toBe('+1234567890');
  });

  it('should include both email and phone in metadata', () => {
    const doc = createContactDocument(
      'id-1',
      'John',
      'Doe',
      'john@example.com',
      '+1234567890'
    );

    expect(doc.metadata).toBe('john@example.com +1234567890');
  });

  it('should not include metadata property if no email or phone', () => {
    const doc = createContactDocument('id-1', 'John', 'Doe');

    expect(doc.metadata).toBeUndefined();
  });

  it('should use provided timestamps', () => {
    const createdAt = 1000;
    const updatedAt = 2000;
    const doc = createContactDocument(
      'id-1',
      'John',
      'Doe',
      null,
      null,
      createdAt,
      updatedAt
    );

    expect(doc.createdAt).toBe(1000);
    expect(doc.updatedAt).toBe(2000);
  });
});

describe('createNoteDocument', () => {
  it('should create document with title and content', () => {
    const doc = createNoteDocument('id-1', 'My Note', 'Note content here');

    expect(doc.id).toBe('id-1');
    expect(doc.entityType).toBe('note');
    expect(doc.title).toBe('My Note');
    expect(doc.content).toBe('Note content here');
  });

  it('should handle empty title', () => {
    const doc = createNoteDocument('id-1', '', 'Content');

    expect(doc.title).toBe('Untitled');
  });

  it('should not include content property if null', () => {
    const doc = createNoteDocument('id-1', 'Title', null);

    expect(doc.content).toBeUndefined();
  });
});

describe('createEmailDocument', () => {
  it('should create document with subject and body', () => {
    const doc = createEmailDocument(
      'id-1',
      'Hello World',
      'Email body text',
      'sender@example.com',
      'recipient@example.com'
    );

    expect(doc.id).toBe('id-1');
    expect(doc.entityType).toBe('email');
    expect(doc.title).toBe('Hello World');
    expect(doc.content).toBe('Email body text');
    expect(doc.metadata).toBe(
      'from:sender@example.com to:recipient@example.com'
    );
  });

  it('should handle no subject', () => {
    const doc = createEmailDocument('id-1', null, 'Body');

    expect(doc.title).toBe('(No Subject)');
  });

  it('should not include content if no body', () => {
    const doc = createEmailDocument('id-1', 'Subject');

    expect(doc.content).toBeUndefined();
  });

  it('should not include metadata if no from/to', () => {
    const doc = createEmailDocument('id-1', 'Subject', 'Body');

    expect(doc.metadata).toBeUndefined();
  });
});

describe('createPlaylistDocument', () => {
  it('should create document with name', () => {
    const doc = createPlaylistDocument('id-1', 'My Playlist');

    expect(doc.id).toBe('id-1');
    expect(doc.entityType).toBe('playlist');
    expect(doc.title).toBe('My Playlist');
  });

  it('should include description as content', () => {
    const doc = createPlaylistDocument('id-1', 'Playlist', 'A great playlist');

    expect(doc.content).toBe('A great playlist');
  });

  it('should handle empty name', () => {
    const doc = createPlaylistDocument('id-1', '');

    expect(doc.title).toBe('Untitled Playlist');
  });
});

describe('createAlbumDocument', () => {
  it('should create document with name', () => {
    const doc = createAlbumDocument('id-1', 'Album Name');

    expect(doc.id).toBe('id-1');
    expect(doc.entityType).toBe('album');
    expect(doc.title).toBe('Album Name');
  });

  it('should include artist as metadata', () => {
    const doc = createAlbumDocument('id-1', 'Album', 'Artist Name');

    expect(doc.metadata).toBe('Artist Name');
  });

  it('should handle empty name', () => {
    const doc = createAlbumDocument('id-1', '');

    expect(doc.title).toBe('Unknown Album');
  });
});

describe('createFileDocument', () => {
  it('should create document with name', () => {
    const doc = createFileDocument('id-1', 'document.pdf');

    expect(doc.id).toBe('id-1');
    expect(doc.entityType).toBe('file');
    expect(doc.title).toBe('document.pdf');
  });

  it('should include mimeType as metadata', () => {
    const doc = createFileDocument('id-1', 'document.pdf', 'application/pdf');

    expect(doc.metadata).toBe('application/pdf');
  });

  it('should handle empty name', () => {
    const doc = createFileDocument('id-1', '');

    expect(doc.title).toBe('Unnamed File');
  });
});

describe('createAIConversationDocument', () => {
  it('should create document with title', () => {
    const doc = createAIConversationDocument('id-1', 'Chat about coding');

    expect(doc.id).toBe('id-1');
    expect(doc.entityType).toBe('ai_conversation');
    expect(doc.title).toBe('Chat about coding');
  });

  it('should include preview as content', () => {
    const doc = createAIConversationDocument(
      'id-1',
      'Chat',
      'First message preview...'
    );

    expect(doc.content).toBe('First message preview...');
  });

  it('should handle empty title', () => {
    const doc = createAIConversationDocument('id-1', '');

    expect(doc.title).toBe('AI Conversation');
  });
});

describe('createDocumentFromEntity', () => {
  it('should create contact document', () => {
    const doc = createDocumentFromEntity({
      type: 'contact',
      id: 'id-1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com'
    });

    expect(doc.entityType).toBe('contact');
    expect(doc.title).toBe('John Doe');
  });

  it('should create note document', () => {
    const doc = createDocumentFromEntity({
      type: 'note',
      id: 'id-1',
      title: 'My Note',
      content: 'Content'
    });

    expect(doc.entityType).toBe('note');
    expect(doc.title).toBe('My Note');
  });

  it('should create email document', () => {
    const doc = createDocumentFromEntity({
      type: 'email',
      id: 'id-1',
      subject: 'Hello',
      body: 'Email body'
    });

    expect(doc.entityType).toBe('email');
    expect(doc.title).toBe('Hello');
  });

  it('should create playlist document', () => {
    const doc = createDocumentFromEntity({
      type: 'playlist',
      id: 'id-1',
      name: 'My Playlist'
    });

    expect(doc.entityType).toBe('playlist');
    expect(doc.title).toBe('My Playlist');
  });

  it('should create album document', () => {
    const doc = createDocumentFromEntity({
      type: 'album',
      id: 'id-1',
      name: 'Album Name'
    });

    expect(doc.entityType).toBe('album');
    expect(doc.title).toBe('Album Name');
  });

  it('should create file document', () => {
    const doc = createDocumentFromEntity({
      type: 'file',
      id: 'id-1',
      name: 'document.pdf'
    });

    expect(doc.entityType).toBe('file');
    expect(doc.title).toBe('document.pdf');
  });

  it('should create ai_conversation document', () => {
    const doc = createDocumentFromEntity({
      type: 'ai_conversation',
      id: 'id-1',
      title: 'AI Chat'
    });

    expect(doc.entityType).toBe('ai_conversation');
    expect(doc.title).toBe('AI Chat');
  });
});
