import { ThemeProvider } from '@tearleads/ui';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { ContactDetail } from './ContactDetail';

export const TEST_CONTACT = {
  id: 'contact-123',
  firstName: 'John',
  lastName: 'Doe',
  birthday: '1990-05-15',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
  deleted: false
};

export const TEST_EMAILS = [
  {
    id: 'email-1',
    contactId: 'contact-123',
    email: 'john@example.com',
    label: 'work',
    isPrimary: true
  },
  {
    id: 'email-2',
    contactId: 'contact-123',
    email: 'john.personal@example.com',
    label: 'personal',
    isPrimary: false
  }
];

export const TEST_PHONES = [
  {
    id: 'phone-1',
    contactId: 'contact-123',
    phoneNumber: '+1-555-0100',
    label: 'mobile',
    isPrimary: true
  }
];

export function createMockSelectChain(results: unknown[][]) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(() => {
          const result = results[callIndex] ?? [];
          callIndex++;
          return Promise.resolve(result);
        }),
        orderBy: vi.fn().mockImplementation(() => {
          const result = results[callIndex] ?? [];
          callIndex++;
          return Promise.resolve(result);
        })
      }),
      orderBy: vi.fn().mockImplementation(() => {
        const result = results[callIndex] ?? [];
        callIndex++;
        return Promise.resolve(result);
      })
    })
  }));
}

export function createMockUpdateChain() {
  return vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined)
    })
  });
}

export function createMockInsertChain() {
  return vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined)
  });
}

export function createMockDeleteChain() {
  return vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined)
  });
}

export function renderContactDetail(contactId: string = 'contact-123') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/contacts/${contactId}`]}>
        <Routes>
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/contacts" element={<div>Contacts List</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}
