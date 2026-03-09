import { render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { expect, vi } from 'vitest';
import type { EmailContactOperations, EmailFolderOperations } from '../context';
import { EmailWindow } from '../components/EmailWindow';
import { mockEmails } from '../components/emailWindowTestFixtures';
import { TestEmailProvider } from './testUtils';

export interface RenderEmailWindowOptions {
  contactOperations?: EmailContactOperations;
  folderOperations?: EmailFolderOperations;
}

export const defaultProps: ComponentProps<typeof EmailWindow> = {
  id: 'test-window',
  onClose: vi.fn(),
  onMinimize: vi.fn(),
  onFocus: vi.fn(),
  zIndex: 100
};

export const renderWithProvider = (
  props: ComponentProps<typeof EmailWindow> = defaultProps,
  options?: RenderEmailWindowOptions
): RenderResult =>
  render(
    <TestEmailProvider
      {...(options?.contactOperations && {
        contactOperations: options.contactOperations
      })}
      {...(options?.folderOperations && {
        folderOperations: options.folderOperations
      })}
    >
      <EmailWindow {...props} />
    </TestEmailProvider>
  );

export const renderLoadedWindow = async (
  props: ComponentProps<typeof EmailWindow> = defaultProps,
  options?: RenderEmailWindowOptions
): Promise<void> => {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ emails: mockEmails })
  });
  renderWithProvider(props, options);
  await waitFor(() => {
    expect(screen.getByText('Test Subject')).toBeInTheDocument();
  });
};
