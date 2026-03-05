import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailBodyOperations } from '../context';
import { TestEmailProvider } from '../test/testUtils';
import { EmailWindow } from './EmailWindow';
import { mockEmails } from './emailWindowTestFixtures';

vi.mock('@tearleads/window-manager', async () => {
  const { windowManagerMock } = await import('./EmailWindowTestMocks');
  return windowManagerMock;
});

vi.mock('./EmailWindowMenuBar', async () => {
  const { EmailWindowMenuBarMock } = await import('./EmailWindowTestMocks');
  return { EmailWindowMenuBar: EmailWindowMenuBarMock };
});

describe('EmailWindow body rendering', () => {
  const defaultProps: ComponentProps<typeof EmailWindow> = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders clear-text email body when body operations return raw MIME', async () => {
    const user = userEvent.setup();
    const mimeParser = await import('../lib/mimeParser.js');
    const parseMimeSpy = vi
      .spyOn(mimeParser, 'parseMimeMessage')
      .mockResolvedValue({
        text: "You're all set to start exploring Tearleads.",
        html: null,
        attachments: []
      });
    const mockBodyOperations: EmailBodyOperations = {
      fetchDecryptedBody: vi
        .fn()
        .mockResolvedValue(
          [
            'From: sender@example.com',
            'To: recipient@example.com',
            'Subject: Test Subject',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            '',
            "You're all set to start exploring Tearleads.",
            ''
          ].join('\r\n')
        )
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    render(
      <TestEmailProvider bodyOperations={mockBodyOperations}>
        <EmailWindow {...defaultProps} />
      </TestEmailProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Subject')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Test Subject'));

    await waitFor(() => {
      expect(mockBodyOperations.fetchDecryptedBody).toHaveBeenCalledWith(
        'email-1'
      );
      expect(parseMimeSpy).toHaveBeenCalled();
      expect(
        screen.getByText(/start exploring Tearleads/i)
      ).toBeInTheDocument();
    });

    parseMimeSpy.mockRestore();
  });
});
