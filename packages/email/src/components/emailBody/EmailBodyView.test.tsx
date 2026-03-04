import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedEmailBody } from '../../types/emailBody';
import { EmailBodyView } from './EmailBodyView';

describe('EmailBodyView', () => {
  const noop = () => {};

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading spinner', () => {
    const { container } = render(
      <EmailBodyView
        body={null}
        loading={true}
        error={null}
        viewMode="text"
        onViewModeChange={noop}
      />
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows error message', () => {
    render(
      <EmailBodyView
        body={null}
        loading={false}
        error="Failed to decrypt"
        viewMode="text"
        onViewModeChange={noop}
      />
    );

    expect(screen.getByText('Failed to decrypt')).toBeDefined();
  });

  it('shows fallback when body is null', () => {
    render(
      <EmailBodyView
        body={null}
        loading={false}
        error={null}
        viewMode="text"
        onViewModeChange={noop}
      />
    );

    expect(screen.getByText('No email body available')).toBeDefined();
  });

  it('renders plain text body', () => {
    const body: ParsedEmailBody = {
      text: 'Hello plain text',
      html: null,
      attachments: []
    };

    render(
      <EmailBodyView
        body={body}
        loading={false}
        error={null}
        viewMode="text"
        onViewModeChange={noop}
      />
    );

    expect(screen.getByText('Hello plain text')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'HTML' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Text' })).toBeNull();
  });

  it('renders HTML body and shows toggle buttons', () => {
    const body: ParsedEmailBody = {
      text: 'Fallback text',
      html: '<p>Rendered HTML</p>',
      attachments: []
    };

    render(
      <EmailBodyView
        body={body}
        loading={false}
        error={null}
        viewMode="html"
        onViewModeChange={noop}
      />
    );

    expect(screen.getByText('Rendered HTML')).toBeDefined();
    expect(screen.getByRole('button', { name: 'HTML' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Text' })).toBeDefined();
  });

  it('switches between HTML and text views via toggle', async () => {
    const body: ParsedEmailBody = {
      text: 'Text version',
      html: '<p>HTML version</p>',
      attachments: []
    };

    const onViewModeChange = vi.fn();
    const user = userEvent.setup();

    render(
      <EmailBodyView
        body={body}
        loading={false}
        error={null}
        viewMode="html"
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Text' }));
    expect(onViewModeChange).toHaveBeenCalledWith('text');

    await user.click(screen.getByRole('button', { name: 'HTML' }));
    expect(onViewModeChange).toHaveBeenCalledWith('html');
  });

  it('renders text view when viewMode is text even with HTML available', () => {
    const body: ParsedEmailBody = {
      text: 'Text version',
      html: '<p>HTML version</p>',
      attachments: []
    };

    render(
      <EmailBodyView
        body={body}
        loading={false}
        error={null}
        viewMode="text"
        onViewModeChange={noop}
      />
    );

    expect(screen.getByText('Text version')).toBeDefined();
    expect(screen.queryByText('HTML version')).toBeNull();
  });

  it('renders empty pre when body has no text in text mode', () => {
    const body: ParsedEmailBody = {
      text: null,
      html: null,
      attachments: []
    };

    const { container } = render(
      <EmailBodyView
        body={body}
        loading={false}
        error={null}
        viewMode="text"
        onViewModeChange={noop}
      />
    );

    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toBe('');
  });
});
