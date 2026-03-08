import { describe, expect, it, vi } from 'vitest';
import { navigateToPath } from './navigation';

describe('navigation', () => {
  it('delegates navigation to location assign', () => {
    const assignMock = vi.fn();
    const locationNavigator = { assign: assignMock };

    navigateToPath('/es/docs/api', locationNavigator);

    expect(assignMock).toHaveBeenCalledWith('/es/docs/api');
  });
});
