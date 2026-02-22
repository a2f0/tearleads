import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import type { VfsObjectType } from '../lib/vfsTypes';

/**
 * Represents an item in the clipboard
 */
interface ClipboardItem {
  id: string;
  objectType: VfsObjectType;
  name: string;
}

/**
 * Type of clipboard operation
 */
type ClipboardOperation = 'cut' | 'copy';

/**
 * Clipboard state
 */
interface ClipboardState {
  items: ClipboardItem[];
  operation: ClipboardOperation | null;
}

/**
 * Context value interface
 */
interface VfsClipboardContextValue {
  /** Current clipboard state */
  clipboard: ClipboardState;
  /** Cut items to clipboard */
  cut: (items: ClipboardItem[]) => void;
  /** Copy items to clipboard */
  copy: (items: ClipboardItem[]) => void;
  /** Clear the clipboard */
  clear: () => void;
  /** Check if clipboard has items */
  hasItems: boolean;
  /** Check if operation is cut */
  isCut: boolean;
  /** Check if operation is copy */
  isCopy: boolean;
}

const VfsClipboardContext = createContext<VfsClipboardContextValue | null>(
  null
);

interface VfsClipboardProviderProps {
  children: ReactNode;
}

const EMPTY_CLIPBOARD: ClipboardState = {
  items: [],
  operation: null
};

/**
 * Provider component that supplies clipboard state to VFS explorer components
 */
export function VfsClipboardProvider({ children }: VfsClipboardProviderProps) {
  const [clipboard, setClipboard] = useState<ClipboardState>(EMPTY_CLIPBOARD);

  const cut = useCallback((items: ClipboardItem[]) => {
    setClipboard({ items, operation: 'cut' });
  }, []);

  const copy = useCallback((items: ClipboardItem[]) => {
    setClipboard({ items, operation: 'copy' });
  }, []);

  const clear = useCallback(() => {
    setClipboard(EMPTY_CLIPBOARD);
  }, []);

  const hasItems = clipboard.items.length > 0;
  const isCut = clipboard.operation === 'cut';
  const isCopy = clipboard.operation === 'copy';

  return (
    <VfsClipboardContext.Provider
      value={{
        clipboard,
        cut,
        copy,
        clear,
        hasItems,
        isCut,
        isCopy
      }}
    >
      {children}
    </VfsClipboardContext.Provider>
  );
}

/**
 * Hook to access VFS clipboard context
 * @throws Error if used outside VfsClipboardProvider
 */
export function useVfsClipboard(): VfsClipboardContextValue {
  const context = useContext(VfsClipboardContext);
  if (!context) {
    throw new Error(
      'useVfsClipboard must be used within a VfsClipboardProvider'
    );
  }
  return context;
}
