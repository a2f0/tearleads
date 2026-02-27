import {
  type Database,
  files,
  walletItemMedia,
  walletItems
} from '@tearleads/db/sqlite';
import { and, desc, eq } from 'drizzle-orm';

import type {
  SaveWalletItemInput,
  SaveWalletItemResult,
  WalletItemDetailRecord,
  WalletItemSummary,
  WalletMediaFileOption
} from './walletData';
import { buildWalletMetadata, parseWalletMetadata } from './walletMetadata';
import { isWalletItemType } from './walletTypes';

export interface WalletTracker {
  listItems: () => Promise<WalletItemSummary[]>;
  getItemDetail: (itemId: string) => Promise<WalletItemDetailRecord | null>;
  listMediaFiles: () => Promise<WalletMediaFileOption[]>;
  saveItem: (input: SaveWalletItemInput) => Promise<SaveWalletItemResult>;
  softDeleteItem: (itemId: string) => Promise<void>;
}

export function createWalletTracker(db: Database): WalletTracker {
  return {
    listItems: async () => {
      const rows = await db
        .select({
          id: walletItems.id,
          itemType: walletItems.itemType,
          displayName: walletItems.displayName,
          documentNumberLast4: walletItems.documentNumberLast4,
          expiresOn: walletItems.expiresOn,
          updatedAt: walletItems.updatedAt,
          metadata: walletItems.metadata
        })
        .from(walletItems)
        .where(eq(walletItems.deleted, false))
        .orderBy(desc(walletItems.updatedAt));

      return rows.map((row) => {
        const itemType = isWalletItemType(row.itemType)
          ? row.itemType
          : 'other';
        const parsed = parseWalletMetadata(itemType, row.metadata);
        return {
          id: row.id,
          itemType,
          itemSubtype: parsed.itemSubtype,
          displayName: row.displayName,
          documentNumberLast4: row.documentNumberLast4,
          expiresOn: row.expiresOn,
          updatedAt: row.updatedAt
        };
      });
    },

    getItemDetail: async (itemId) => {
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
          metadata: walletItems.metadata,
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

      const itemType = isWalletItemType(row.itemType) ? row.itemType : 'other';
      const parsed = parseWalletMetadata(itemType, row.metadata);

      const mediaRows = await db
        .select({
          side: walletItemMedia.side,
          fileId: walletItemMedia.fileId,
          fileName: files.name
        })
        .from(walletItemMedia)
        .innerJoin(files, eq(walletItemMedia.fileId, files.id))
        .where(eq(walletItemMedia.walletItemId, itemId));

      const frontMedia = mediaRows.find((media) => media.side === 'front');
      const backMedia = mediaRows.find((media) => media.side === 'back');

      const frontFileId = frontMedia?.fileId ?? null;
      const frontFileName = frontMedia?.fileName ?? null;
      const backFileId = backMedia?.fileId ?? null;
      const backFileName = backMedia?.fileName ?? null;

      return {
        id: row.id,
        itemType,
        itemSubtype: parsed.itemSubtype,
        displayName: row.displayName,
        issuingAuthority: row.issuingAuthority,
        countryCode: row.countryCode,
        documentNumberLast4: row.documentNumberLast4,
        issuedOn: row.issuedOn,
        expiresOn: row.expiresOn,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        subtypeFields: parsed.subtypeFields,
        frontFileId,
        frontFileName,
        backFileId,
        backFileName
      };
    },

    listMediaFiles: async () => {
      const rows = await db
        .select({
          id: files.id,
          name: files.name,
          mimeType: files.mimeType,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath,
          uploadDate: files.uploadDate
        })
        .from(files)
        .where(eq(files.deleted, false))
        .orderBy(desc(files.uploadDate));

      return rows.filter(
        (row) =>
          row.mimeType.startsWith('image/') ||
          row.mimeType === 'application/pdf'
      );
    },

    saveItem: async (input) => {
      const now = new Date();
      const metadata = buildWalletMetadata(
        input.itemType,
        input.itemSubtype,
        input.subtypeFields
      );

      if (input.id) {
        await db
          .update(walletItems)
          .set({
            itemType: input.itemType,
            displayName: input.displayName,
            issuingAuthority: input.issuingAuthority || null,
            countryCode: input.countryCode || null,
            documentNumberLast4: input.documentNumberLast4 || null,
            issuedOn: input.issuedOn
              ? new Date(`${input.issuedOn}T00:00:00`)
              : null,
            expiresOn: input.expiresOn
              ? new Date(`${input.expiresOn}T00:00:00`)
              : null,
            notes: input.notes || null,
            metadata,
            updatedAt: now
          })
          .where(eq(walletItems.id, input.id));

        await syncMediaLinks(db, input.id, input.frontFileId, input.backFileId);

        return { id: input.id, created: false };
      }

      const id = `wallet_${globalThis.crypto.randomUUID()}`;

      await db.insert(walletItems).values({
        id,
        itemType: input.itemType,
        displayName: input.displayName,
        issuingAuthority: input.issuingAuthority || null,
        countryCode: input.countryCode || null,
        documentNumberLast4: input.documentNumberLast4 || null,
        issuedOn: input.issuedOn
          ? new Date(`${input.issuedOn}T00:00:00`)
          : null,
        expiresOn: input.expiresOn
          ? new Date(`${input.expiresOn}T00:00:00`)
          : null,
        notes: input.notes || null,
        metadata,
        createdAt: now,
        updatedAt: now,
        deleted: false
      });

      await syncMediaLinks(db, id, input.frontFileId, input.backFileId);

      return { id, created: true };
    },

    softDeleteItem: async (itemId) => {
      await db
        .update(walletItems)
        .set({ deleted: true, updatedAt: new Date() })
        .where(eq(walletItems.id, itemId));
    }
  };
}

async function syncMediaLinks(
  db: Database,
  walletItemId: string,
  frontFileId: string | null,
  backFileId: string | null
): Promise<void> {
  await db
    .delete(walletItemMedia)
    .where(eq(walletItemMedia.walletItemId, walletItemId));

  const mediaValues: {
    id: string;
    walletItemId: string;
    fileId: string;
    side: 'front' | 'back';
    createdAt: Date;
  }[] = [];

  const now = new Date();

  if (frontFileId) {
    mediaValues.push({
      id: `wm_${globalThis.crypto.randomUUID()}`,
      walletItemId,
      fileId: frontFileId,
      side: 'front',
      createdAt: now
    });
  }

  if (backFileId) {
    mediaValues.push({
      id: `wm_${globalThis.crypto.randomUUID()}`,
      walletItemId,
      fileId: backFileId,
      side: 'back',
      createdAt: now
    });
  }

  if (mediaValues.length > 0) {
    await db.insert(walletItemMedia).values(mediaValues);
  }
}
