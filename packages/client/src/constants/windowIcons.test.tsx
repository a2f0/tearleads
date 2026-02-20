import { describe, expect, it } from 'vitest';
import {
  getWindowIcon,
  getWindowLabel,
  WINDOW_ICONS,
  WINDOW_LABELS
} from './windowIcons';

describe('windowIcons', () => {
  describe('WINDOW_ICONS', () => {
    it('contains icon for notes window type', () => {
      expect(WINDOW_ICONS.notes).toBeDefined();
    });

    it('contains icon for all standard window types', () => {
      const expectedTypes = [
        'notes',
        'console',
        'settings',
        'files',
        'search',
        'calendar'
      ];
      for (const type of expectedTypes) {
        expect(WINDOW_ICONS[type as keyof typeof WINDOW_ICONS]).toBeDefined();
      }
    });
  });

  describe('WINDOW_LABELS', () => {
    it('contains label for notes window type', () => {
      expect(WINDOW_LABELS.notes).toBe('Notes');
    });

    it('contains labels for all standard window types', () => {
      const expectedLabels: Record<string, string> = {
        notes: 'Notes',
        console: 'Console',
        settings: 'Settings',
        files: 'Files',
        search: 'Search',
        calendar: 'Calendar'
      };
      for (const [type, label] of Object.entries(expectedLabels)) {
        expect(WINDOW_LABELS[type as keyof typeof WINDOW_LABELS]).toBe(label);
      }
    });
  });

  describe('getWindowIcon', () => {
    it('returns the icon for a known window type', () => {
      const icon = getWindowIcon('notes');
      expect(icon).toBeDefined();
      expect(icon).toBe(WINDOW_ICONS.notes);
    });

    it('returns fallback AppWindow icon for unknown window type', () => {
      const icon = getWindowIcon('unknown-type');
      expect(icon).toBeDefined();
    });
  });

  describe('getWindowLabel', () => {
    it('returns title when provided', () => {
      const label = getWindowLabel('notes', 'My Custom Title');
      expect(label).toBe('My Custom Title');
    });

    it('returns WINDOW_LABELS entry when no title provided', () => {
      const label = getWindowLabel('notes');
      expect(label).toBe('Notes');
    });

    it('returns type string when no title and type not in WINDOW_LABELS', () => {
      const label = getWindowLabel('unknown-type');
      expect(label).toBe('unknown-type');
    });

    it('returns empty string title when explicitly provided', () => {
      // Title takes precedence even if empty string (not nullish)
      const label = getWindowLabel('notes', '');
      expect(label).toBe('');
    });
  });
});
