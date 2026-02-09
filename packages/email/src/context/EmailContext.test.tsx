import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailContext,
  type EmailContextValue,
  EmailProvider,
  type EmailUIComponents,
  useEmailContactOperations,
  useEmailContext,
  useEmailFolderOperations,
  useHasEmailContactOperations,
  useHasEmailFolderOperations
} from './EmailContext.js';

// Suppress React act() warnings
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const mockUI: EmailUIComponents = {
  DropdownMenu: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuSeparator: () => null,
  WindowOptionsMenuItem: () => null,
  AboutMenuItem: () => null,
  BackLink: () => null,
  RefreshButton: () => null
};

describe('EmailContext', () => {
  describe('useEmailContext', () => {
    it('throws error when used outside provider', () => {
      expect(() => {
        renderHook(() => useEmailContext());
      }).toThrow('useEmailContext must be used within an EmailProvider');
    });

    it('returns context value when inside provider', () => {
      const contextValue: EmailContextValue = {
        apiBaseUrl: 'http://test',
        ui: mockUI
      };

      const wrapper = ({ children }: { children: ReactNode }) => (
        <EmailContext.Provider value={contextValue}>
          {children}
        </EmailContext.Provider>
      );

      const { result } = renderHook(() => useEmailContext(), { wrapper });

      expect(result.current).toBeDefined();
      expect(result.current.apiBaseUrl).toBe('http://test');
      expect(result.current.ui).toBeDefined();
    });
  });

  describe('useEmailFolderOperations', () => {
    it('throws error when folderOperations not provided', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <EmailProvider apiBaseUrl="http://test" ui={mockUI}>
          {children}
        </EmailProvider>
      );

      expect(() => {
        renderHook(() => useEmailFolderOperations(), { wrapper });
      }).toThrow('Email folder operations are not available');
    });

    it('returns folder operations when provided', () => {
      const mockFolderOps = {
        fetchFolders: vi.fn().mockResolvedValue([]),
        createFolder: vi.fn(),
        renameFolder: vi.fn(),
        deleteFolder: vi.fn(),
        moveFolder: vi.fn(),
        initializeSystemFolders: vi.fn(),
        getFolderByType: vi.fn()
      };

      const contextValue: EmailContextValue = {
        apiBaseUrl: 'http://test',
        ui: mockUI,
        folderOperations: mockFolderOps
      };

      const wrapper = ({ children }: { children: ReactNode }) => (
        <EmailContext.Provider value={contextValue}>
          {children}
        </EmailContext.Provider>
      );

      const { result } = renderHook(() => useEmailFolderOperations(), {
        wrapper
      });

      expect(result.current).toBe(mockFolderOps);
    });
  });

  describe('useHasEmailFolderOperations', () => {
    it('returns false when folderOperations not provided', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <EmailProvider apiBaseUrl="http://test" ui={mockUI}>
          {children}
        </EmailProvider>
      );

      const { result } = renderHook(() => useHasEmailFolderOperations(), {
        wrapper
      });

      expect(result.current).toBe(false);
    });

    it('returns true when folderOperations provided', () => {
      const mockFolderOps = {
        fetchFolders: vi.fn().mockResolvedValue([]),
        createFolder: vi.fn(),
        renameFolder: vi.fn(),
        deleteFolder: vi.fn(),
        moveFolder: vi.fn(),
        initializeSystemFolders: vi.fn(),
        getFolderByType: vi.fn()
      };

      const contextValue: EmailContextValue = {
        apiBaseUrl: 'http://test',
        ui: mockUI,
        folderOperations: mockFolderOps
      };

      const wrapper = ({ children }: { children: ReactNode }) => (
        <EmailContext.Provider value={contextValue}>
          {children}
        </EmailContext.Provider>
      );

      const { result } = renderHook(() => useHasEmailFolderOperations(), {
        wrapper
      });

      expect(result.current).toBe(true);
    });
  });

  describe('useEmailContactOperations', () => {
    it('throws error when contactOperations not provided', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <EmailProvider apiBaseUrl="http://test" ui={mockUI}>
          {children}
        </EmailProvider>
      );

      expect(() => {
        renderHook(() => useEmailContactOperations(), { wrapper });
      }).toThrow('Email contact operations are not available');
    });

    it('returns contact operations when provided', () => {
      const mockContactOps = {
        fetchContactEmails: vi.fn().mockResolvedValue([])
      };

      const contextValue: EmailContextValue = {
        apiBaseUrl: 'http://test',
        ui: mockUI,
        contactOperations: mockContactOps
      };

      const wrapper = ({ children }: { children: ReactNode }) => (
        <EmailContext.Provider value={contextValue}>
          {children}
        </EmailContext.Provider>
      );

      const { result } = renderHook(() => useEmailContactOperations(), {
        wrapper
      });

      expect(result.current).toBe(mockContactOps);
    });
  });

  describe('useHasEmailContactOperations', () => {
    it('returns false when contactOperations not provided', () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <EmailProvider apiBaseUrl="http://test" ui={mockUI}>
          {children}
        </EmailProvider>
      );

      const { result } = renderHook(() => useHasEmailContactOperations(), {
        wrapper
      });

      expect(result.current).toBe(false);
    });

    it('returns true when contactOperations provided', () => {
      const mockContactOps = {
        fetchContactEmails: vi.fn().mockResolvedValue([])
      };

      const contextValue: EmailContextValue = {
        apiBaseUrl: 'http://test',
        ui: mockUI,
        contactOperations: mockContactOps
      };

      const wrapper = ({ children }: { children: ReactNode }) => (
        <EmailContext.Provider value={contextValue}>
          {children}
        </EmailContext.Provider>
      );

      const { result } = renderHook(() => useHasEmailContactOperations(), {
        wrapper
      });

      expect(result.current).toBe(true);
    });
  });
});
