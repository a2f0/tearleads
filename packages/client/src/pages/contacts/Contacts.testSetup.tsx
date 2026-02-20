/**
 * Shared test setup for Contacts component tests.
 *
 * IMPORTANT: vi.mock() calls MUST remain inline in each test file.
 * This file exports mock functions and test data that can be referenced
 * by those vi.mock() calls.
 */
import {
  act,
  type RenderResult,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, vi } from 'vitest';
import { Contacts } from './Contacts';

// Mock function exports - these are referenced by vi.mock() calls in test files
export const mockNavigate = vi.fn();
export const mockUseDatabaseContext = vi.fn();
export const mockOrderBy = vi.fn();
export const mockUpdate = vi.fn();
export const mockSet = vi.fn();
export const mockUpdateWhere = vi.fn();
export const mockParseFile = vi.fn();
export const mockImportContacts = vi.fn();
export const mockExportContact = vi.fn();

// Database mock object - used by vi.mock('@/db')
export const dbMock = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: mockOrderBy,
  update: mockUpdate
};

// Test data exports
export const createMockContact = (overrides = {}) => ({
  id: '1',
  firstName: 'John',
  lastName: 'Doe',
  birthday: null,
  primaryEmail: null,
  primaryPhone: null,
  createdAt: new Date(),
  ...overrides
});

export const mockContactsList = [
  {
    id: '1',
    firstName: 'John',
    lastName: 'Doe',
    birthday: '1990-01-01',
    primaryEmail: 'john@example.com',
    primaryPhone: '555-1234',
    createdAt: new Date()
  },
  {
    id: '2',
    firstName: 'Jane',
    lastName: null,
    birthday: null,
    primaryEmail: 'jane@example.com',
    primaryPhone: null,
    createdAt: new Date()
  }
];

export const mockContextMenuContact = {
  id: '1',
  firstName: 'John',
  lastName: 'Doe',
  birthday: null,
  primaryEmail: 'john@example.com',
  primaryPhone: '555-1234',
  createdAt: new Date()
};

// Render helpers
export function renderContactsRaw(): RenderResult {
  return render(
    <MemoryRouter>
      <Contacts />
    </MemoryRouter>
  );
}

export async function renderContacts(): Promise<RenderResult> {
  const result = renderContactsRaw();
  // Flush the setTimeout(fn, 0) used for instance-aware fetching
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading database...')).toBeNull();
  });
  return result;
}

// Setup helpers
export function setupDefaultMocks(): void {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  // Default: database is unlocked
  mockUseDatabaseContext.mockReturnValue({
    isUnlocked: true,
    isLoading: false
  });

  // Setup default mock response
  mockOrderBy.mockResolvedValue([]);

  // Reset update chain mocks
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
}

export function teardownMocks(): void {
  vi.useRealTimers();
}
