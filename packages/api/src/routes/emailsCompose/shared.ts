import { randomUUID } from 'node:crypto';

export interface DraftRequest {
  id?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  attachments?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    content?: string;
  }>;
}

export interface SendRequest {
  draftId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    content: string;
  }>;
}

export interface Draft {
  id: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

const draftsStore = new Map<string, Map<string, Draft>>();

export function getUserDrafts(userId: string): Map<string, Draft> {
  let userDrafts = draftsStore.get(userId);
  if (!userDrafts) {
    userDrafts = new Map();
    draftsStore.set(userId, userDrafts);
  }
  return userDrafts;
}

export function createDraftId(): string {
  return randomUUID();
}
