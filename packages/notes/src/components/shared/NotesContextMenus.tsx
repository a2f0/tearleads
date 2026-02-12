import { Info, Plus, Trash2 } from 'lucide-react';
import type { ComponentType } from 'react';
import type {
  ContextMenuItemProps,
  ContextMenuProps,
  NotesTranslationKey,
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

function label(t: TranslationFunction, key: NotesTranslationKey) {
  return t(key);
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
            {label(t, 'getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={onDelete}
          >
            {label(t, 'delete')}
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
            {label(t, 'newNote')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
