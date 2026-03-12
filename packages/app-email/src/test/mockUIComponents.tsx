import type { EmailUIComponents } from '../context';

export const mockUIComponents: EmailUIComponents = {
  BackLink: ({ defaultLabel }) => (
    <a href="/" data-testid="back-link">
      {defaultLabel}
    </a>
  ),
  RefreshButton: ({ onClick, loading }) => (
    <button
      type="button"
      onClick={onClick}
      data-testid="refresh-button"
      data-loading={loading}
    >
      Refresh
    </button>
  )
};
