import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface NavigateWithFromOptions {
  fromLabel?: string;
}

export function useNavigateWithFrom() {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(
    (to: string, options?: NavigateWithFromOptions) => {
      navigate(to, {
        state: {
          from: location.pathname,
          fromLabel: options?.fromLabel
        }
      });
    },
    [navigate, location.pathname]
  );
}
