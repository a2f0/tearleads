import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface NavigateWithFromOptions {
  fromLabel?: string;
  state?: Record<string, unknown>;
}

export function useNavigateWithFrom() {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(
    (to: string, options?: NavigateWithFromOptions) => {
      navigate(to, {
        state: {
          from: location.pathname,
          fromLabel: options?.fromLabel,
          ...options?.state
        }
      });
    },
    [navigate, location.pathname]
  );
}
