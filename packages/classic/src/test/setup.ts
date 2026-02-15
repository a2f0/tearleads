import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock react-i18next to return the key as the translated string
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // Map translation keys to their English values for tests
      const translations: Record<string, string> = {
        // TagSidebar
        tagsSidebar: 'Tags Sidebar',
        tagListContextMenu: 'Tag list, press Shift+F10 for context menu',
        virtualTags: 'Virtual Tags',
        deletedTags: 'Deleted Tags',
        tagList: 'Tag List',
        searchTags: 'Search tags',
        dragTag: 'Drag tag',
        save: 'Save',
        cancel: 'Cancel',
        saveTagName: 'Save tag name',
        cancelEditing: 'Cancel editing',
        restore: 'Restore',
        restoreTag: 'Restore tag',
        edit: 'Edit',
        editTag: 'Edit tag',
        moveUp: 'Move Up',
        moveUpTag: 'Move tag',
        moveDown: 'Move Down',
        moveDownTag: 'Move tag',
        delete: 'Delete',
        deleteTag: 'Delete tag',
        // NotesPane
        notesPane: 'Notes Pane',
        entryListContextMenu: 'Entry list, press Shift+F10 for context menu',
        noteList: 'Note List',
        searchEntries: 'Search entries',
        dragEntry: 'Drag entry',
        editEntryTitle: 'Edit entry title',
        editEntryBody: 'Edit entry body',
        saveEntry: 'Save entry',
        editNote: 'Edit note',
        moveUpNote: 'Move note',
        moveDownNote: 'Move note',
        // ClassicMenuBar
        sortTags: 'Sort tags',
        sortEntries: 'Sort entries',
        tags: 'Tags',
        entries: 'Entries',
        // ClassicContextMenu
        closeContextMenu: 'Close context menu'
      };
      return translations[key] ?? key;
    },
    i18n: {
      language: 'en'
    }
  })
}));
