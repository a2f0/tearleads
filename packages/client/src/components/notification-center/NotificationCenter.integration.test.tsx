import '../../test/setup-integration';

import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithDatabase } from '../../test/render-with-database';
import { NotificationCenter } from './NotificationCenter';

const defaultProps = {
  id: 'notification-center-integration',
  onClose: vi.fn(),
  onMinimize: vi.fn(),
  onFocus: vi.fn(),
  zIndex: 100
};

describe('NotificationCenter integration', () => {
  beforeEach(async () => {
    await resetTestKeyManager();
  });

  it('loads analytics tab under StrictMode without getting stuck on loading', async () => {
    const user = userEvent.setup();

    await renderWithDatabase(
      <StrictMode>
        <NotificationCenter {...defaultProps} />
      </StrictMode>
    );

    await user.click(screen.getByRole('button', { name: 'Analytics' }));

    await waitFor(() => {
      expect(screen.getByText('Last Hour')).toBeInTheDocument();
    });

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});
