import { getDatabase, getDatabaseAdapter } from '@client/db';
import {
  files,
  vfsRegistry,
  walletItemMedia,
  walletItems
} from '@client/db/schema';
import { readStoredAuth } from '@client/lib/auth-storage';
import { and, desc, eq, like, or } from 'drizzle-orm';

export const WALLET_ITEM_TYPES = [
  'passport',
  'driverLicense',
  'birthCertificate',
  'creditCard',
  'debitCard',
  'identityCard',
  'insuranceCard',
  'other'
] as const;

export type WalletItemType = (typeof WALLET_ITEM_TYPES)[number];
export type WalletMediaSide = 'front' | 'back';

const WALLET_ITEM_TYPE_LABELS: Record<WalletItemType, string> = {
  passport: 'Passport',
  driverLicense: 'Driver License',
  birthCertificate: 'Birth Certificate',
  creditCard: 'Credit Card',
  debitCard: 'Debit Card',
  identityCard: 'Identity Card',
  insuranceCard: 'Insurance Card',
  other: 'Other'
};

export interface WalletItemSummary {
  id: string;
  itemType: WalletItemType;
  displayName: string;
  documentNumberLast4: string | null;
  expiresOn: Date | null;
  updatedAt: Date;
}

export interface WalletMediaFileOption {
  id: string;
  name: string;
  mimeType: string;
}

export interface WalletItemDetailRecord extends WalletItemSummary {
  issuingAuthority: string | null;
  countryCode: string | null;
  issuedOn: Date | null;
  notes: string | null;
  createdAt: Date;
  frontFileId: string | null;
  frontFileName: string | null;
  backFileId: string | null;
  backFileName: string | null;
}

export interface SaveWalletItemInput {
  id?: string;
  itemType: WalletItemType;
  displayName: string;
  issuingAuthority: string;
  countryCode: string;
  documentNumberLast4: string;
  issuedOn: string;
  expiresOn: string;
  notes: string;
  frontFileId: string | null;
  backFileId: string | null;
}

export interface SaveWalletItemResult {
  id: string;
  created: boolean;
}

function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLast4(value: string): string | null {
  const compact = value.replace(/\s+/g, '');
  return compact.length > 0 ? compact.slice(-4) : null;
}

function parseDateInput(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toDateInputValue(value: Date | null): string {
  if (!value) {
    return '';
  }

  return value.toISOString().slice(0, 10);
}

export function getWalletItemTypeLabel(itemType: WalletItemType): string {
  return WALLET_ITEM_TYPE_LABELS[itemType];
}

export async function listWalletItems(): Promise<WalletItemSummary[]> {
  const db = getDatabase();

  return db
    .select({
      id: walletItems.id,
      itemType: walletItems.itemType,
      displayName: walletItems.displayName,
      documentNumberLast4: walletItems.documentNumberLast4,
      expiresOn: walletItems.expiresOn,
      updatedAt: walletItems.updatedAt
    })
    .from(walletItems)
    .where(eq(walletItems.deleted, false))
    .orderBy(desc(walletItems.updatedAt));
}

export async function listWalletMediaFiles(): Promise<WalletMediaFileOption[]> {
  const db = getDatabase();

  return db
    .select({
      id: files.id,
      name: files.name,
      mimeType: files.mimeType
    })
    .from(files)
    .where(
      and(
        eq(files.deleted, false),
        or(
          like(files.mimeType, 'image/%'),
          eq(files.mimeType, 'application/pdf')
        )
      )
    )
    .orderBy(desc(files.uploadDate));
}

export async function getWalletItemDetail(
  itemId: string
): Promise<WalletItemDetailRecord | null> {
  const db = getDatabase();

  const rows = await db
    .select({
      id: walletItems.id,
      itemType: walletItems.itemType,
      displayName: walletItems.displayName,
      issuingAuthority: walletItems.issuingAuthority,
      countryCode: walletItems.countryCode,
      documentNumberLast4: walletItems.documentNumberLast4,
      issuedOn: walletItems.issuedOn,
      expiresOn: walletItems.expiresOn,
      notes: walletItems.notes,
      createdAt: walletItems.createdAt,
      updatedAt: walletItems.updatedAt
    })
    .from(walletItems)
    .where(and(eq(walletItems.id, itemId), eq(walletItems.deleted, false)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const mediaRows = await db
    .select({
      side: walletItemMedia.side,
      fileId: walletItemMedia.fileId,
      fileName: files.name
    })
    .from(walletItemMedia)
    .innerJoin(files, eq(files.id, walletItemMedia.fileId))
    .where(eq(walletItemMedia.walletItemId, itemId));

  let frontFileId: string | null = null;
  let frontFileName: string | null = null;
  let backFileId: string | null = null;
  let backFileName: string | null = null;

  for (const mediaRow of mediaRows) {
    if (mediaRow.side === 'front') {
      frontFileId = mediaRow.fileId;
      frontFileName = mediaRow.fileName;
    }

    if (mediaRow.side === 'back') {
      backFileId = mediaRow.fileId;
      backFileName = mediaRow.fileName;
    }
  }

  return {
    ...row,
    frontFileId,
    frontFileName,
    backFileId,
    backFileName
  };
}

async function assertMediaFileExists(fileId: string): Promise<void> {
  const db = getDatabase();

  const result = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.deleted, false)))
    .limit(1);

  if (result.length === 0) {
    throw new Error('Selected media file does not exist.');
  }
}

async function syncWalletMediaLink(
  itemId: string,
  side: WalletMediaSide,
  fileId: string | null,
  createdAt: Date
): Promise<void> {
  const db = getDatabase();

  const existingRows = await db
    .select({ id: walletItemMedia.id })
    .from(walletItemMedia)
    .where(
      and(
        eq(walletItemMedia.walletItemId, itemId),
        eq(walletItemMedia.side, side)
      )
    )
    .limit(1);

  const existing = existingRows[0];

  if (!fileId) {
    if (existing) {
      await db
        .delete(walletItemMedia)
        .where(eq(walletItemMedia.id, existing.id));
    }
    return;
  }

  await assertMediaFileExists(fileId);

  if (existing) {
    await db
      .update(walletItemMedia)
      .set({ fileId })
      .where(eq(walletItemMedia.id, existing.id));
    return;
  }

  await db.insert(walletItemMedia).values({
    id: crypto.randomUUID(),
    walletItemId: itemId,
    fileId,
    side,
    createdAt
  });
}

export async function saveWalletItem(
  input: SaveWalletItemInput
): Promise<SaveWalletItemResult> {
  const displayName = input.displayName.trim();
  if (displayName.length === 0) {
    throw new Error('Display name is required.');
  }

  const adapter = getDatabaseAdapter();
  const db = getDatabase();
  const now = new Date();
  const created = !input.id;
  const itemId = input.id ?? crypto.randomUUID();
  const auth = readStoredAuth();

  const baseValues = {
    itemType: input.itemType,
    displayName,
    issuingAuthority: toNullableText(input.issuingAuthority),
    countryCode: toNullableText(input.countryCode),
    documentNumberLast4: normalizeLast4(input.documentNumberLast4),
    issuedOn: parseDateInput(input.issuedOn),
    expiresOn: parseDateInput(input.expiresOn),
    notes: toNullableText(input.notes),
    updatedAt: now,
    deleted: false
  };

  await adapter.beginTransaction();
  try {
    if (created) {
      await db.insert(vfsRegistry).values({
        id: itemId,
        objectType: 'walletItem',
        ownerId: auth.user?.id ?? null,
        encryptedSessionKey: null,
        createdAt: now
      });

      await db.insert(walletItems).values({
        id: itemId,
        ...baseValues,
        createdAt: now,
        metadata: null
      });
    } else {
      await db
        .update(walletItems)
        .set(baseValues)
        .where(eq(walletItems.id, itemId));
    }

    await syncWalletMediaLink(itemId, 'front', input.frontFileId, now);
    await syncWalletMediaLink(itemId, 'back', input.backFileId, now);

    await adapter.commitTransaction();
  } catch (error) {
    await adapter.rollbackTransaction();
    throw error;
  }

  return { id: itemId, created };
}

export async function softDeleteWalletItem(itemId: string): Promise<void> {
  const db = getDatabase();
  await db
    .update(walletItems)
    .set({ deleted: true, updatedAt: new Date() })
    .where(eq(walletItems.id, itemId));
}
