/**
 * Hook for document action handlers.
 */

import { eq } from 'drizzle-orm';
import { useCallback, useEffect, useState } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { objectUrlToDataUrl } from '@/lib/chatAttachments';
import { retrieveFileData } from '@/lib/dataRetrieval';
import { canShareFiles, downloadFile, shareFile } from '@/lib/fileUtils';
import { setAttachedImage } from '@/lib/llmRuntime';
import { useNavigateWithFrom } from '@/lib/navigation';
import type { DocumentWithUrl } from './documentTypes';

interface ContextMenuState {
  document: DocumentWithUrl;
  x: number;
  y: number;
}

interface BlankSpaceMenuState {
  x: number;
  y: number;
}

interface UseDocumentsActionsResult {
  contextMenu: ContextMenuState | null;
  blankSpaceMenu: BlankSpaceMenuState | null;
  canShare: boolean;
  handleDownload: (document: DocumentWithUrl, e?: React.MouseEvent) => void;
  handleShare: (document: DocumentWithUrl, e?: React.MouseEvent) => void;
  handleDocumentClick: (document: DocumentWithUrl) => void;
  handleContextMenu: (e: React.MouseEvent, document: DocumentWithUrl) => void;
  handleBlankSpaceContextMenu: (e: React.MouseEvent) => void;
  handleGetInfo: () => void;
  handleDelete: () => Promise<void>;
  handleRestore: () => Promise<void>;
  handleCloseContextMenu: () => void;
  handleAddToAIChat: () => Promise<void>;
  setBlankSpaceMenu: React.Dispatch<
    React.SetStateAction<BlankSpaceMenuState | null>
  >;
}

export function useDocumentsActions(
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setHasFetched: React.Dispatch<React.SetStateAction<boolean>>,
  onSelectDocument?: (documentId: string) => void,
  onUpload?: () => void,
  onOpenAIChat?: () => void
): UseDocumentsActionsResult {
  const navigateWithFrom = useNavigateWithFrom();
  const { currentInstanceId } = useDatabaseContext();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [blankSpaceMenu, setBlankSpaceMenu] =
    useState<BlankSpaceMenuState | null>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  const handleDownload = useCallback(
    async (document: DocumentWithUrl, e?: React.MouseEvent) => {
      e?.stopPropagation();

      try {
        if (!currentInstanceId) throw new Error('No active instance');
        const data = await retrieveFileData(
          document.storagePath,
          currentInstanceId
        );
        downloadFile(data, document.name);
      } catch (err) {
        console.error('Failed to download document:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentInstanceId, setError]
  );

  const handleShare = useCallback(
    async (document: DocumentWithUrl, e?: React.MouseEvent) => {
      e?.stopPropagation();

      try {
        if (!currentInstanceId) throw new Error('No active instance');
        const data = await retrieveFileData(
          document.storagePath,
          currentInstanceId
        );
        await shareFile(data, document.name, document.mimeType);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to share document:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentInstanceId, setError]
  );

  const handleDocumentClick = useCallback(
    (document: DocumentWithUrl) => {
      if (onSelectDocument) {
        onSelectDocument(document.id);
        return;
      }
      navigateWithFrom(`/documents/${document.id}`, {
        fromLabel: 'Back to Documents'
      });
    },
    [navigateWithFrom, onSelectDocument]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, document: DocumentWithUrl) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ document, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleBlankSpaceContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onUpload) return;
      e.preventDefault();
      setBlankSpaceMenu({ x: e.clientX, y: e.clientY });
    },
    [onUpload]
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      if (onSelectDocument) {
        onSelectDocument(contextMenu.document.id);
      } else {
        navigateWithFrom(`/documents/${contextMenu.document.id}`, {
          fromLabel: 'Back to Documents'
        });
      }
      setContextMenu(null);
    }
  }, [contextMenu, navigateWithFrom, onSelectDocument]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, contextMenu.document.id));

      setHasFetched(false);
    } catch (err) {
      console.error('Failed to delete document:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, setHasFetched, setError]);

  const handleRestore = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: false })
        .where(eq(files.id, contextMenu.document.id));

      setHasFetched(false);
    } catch (err) {
      console.error('Failed to restore document:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, setHasFetched, setError]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const openAIChat = useCallback(() => {
    if (onOpenAIChat) {
      onOpenAIChat();
      return;
    }
    navigateWithFrom('/chat', { fromLabel: 'Back to Documents' });
  }, [navigateWithFrom, onOpenAIChat]);

  const handleAddToAIChat = useCallback(async () => {
    if (!contextMenu) return;

    try {
      if (contextMenu.document.thumbnailUrl) {
        const imageDataUrl = await objectUrlToDataUrl(
          contextMenu.document.thumbnailUrl
        );
        setAttachedImage(imageDataUrl);
      }
      openAIChat();
    } catch (err) {
      console.error('Failed to add document to AI chat:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, openAIChat, setError]);

  return {
    contextMenu,
    blankSpaceMenu,
    canShare,
    handleDownload,
    handleShare,
    handleDocumentClick,
    handleContextMenu,
    handleBlankSpaceContextMenu,
    handleGetInfo,
    handleDelete,
    handleRestore,
    handleCloseContextMenu,
    handleAddToAIChat,
    setBlankSpaceMenu
  };
}
