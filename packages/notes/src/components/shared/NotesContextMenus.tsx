import { Info, Plus, Trash2 } from 'lucide-react';
import type { ComponentType } from 'react';
import type {
  ContextMenuItemProps,
  ContextMenuProps,
  TranslationFunction
} from '../../context/NotesContext';

type MenuPosition = { x: number; y: number };

interface NotesContextMenusProps {
  contextMenuPosition: MenuPosition | null;
  blankSpaceMenuPosition: MenuPosition | null;
  onCloseContextMenu: () => void;
  onCloseBlankSpaceMenu: () => void;
  onGetInfo: () => void;
  onDelete: () => void;
  onCreateNoteFromMenu: () => void;
  t: TranslationFunction;
  ContextMenu: ComponentType<ContextMenuProps>;
  ContextMenuItem: ComponentType<ContextMenuItemProps>;
}

export function NotesContextMenus({
  contextMenuPosition,
  blankSpaceMenuPosition,
  onCloseContextMenu,
  onCloseBlankSpaceMenu,
  onGetInfo,
  onDelete,
  onCreateNoteFromMenu,
  t,
  ContextMenu,
  ContextMenuItem
}: NotesContextMenusProps) {
  return (
    <>
      {contextMenuPosition && (
        <ContextMenu
          x={contextMenuPosition.x}
          y={contextMenuPosition.y}
          onClose={onCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={onGetInfo}
          >
            {t('getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={onDelete}
          >
            {t('delete')}
          </ContextMenuItem>
        </ContextMenu>
      )}

      {blankSpaceMenuPosition && (
        <ContextMenu
          x={blankSpaceMenuPosition.x}
          y={blankSpaceMenuPosition.y}
          onClose={onCloseBlankSpaceMenu}
        >
          <ContextMenuItem
            icon={<Plus className="h-4 w-4" />}
            onClick={onCreateNoteFromMenu}
          >
            {t('newNote')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
