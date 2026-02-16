/**
 * Test database provider for Vitest integration tests.
 * Wraps DatabaseProvider with automatic setup and unlock for testing.
 */

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { DatabaseProvider, useDatabaseContext } from '@/db/hooks';

interface TestDatabaseProviderProps {
  children: ReactNode;
  /**
   * Automatically set up and unlock the database before rendering children.
   * Default: true
   */
  autoSetup?: boolean;
  /**
   * Password to use for setup/unlock.
   * Default: 'test-password'
   */
  password?: string;
  /**
   * Show loading state while database is initializing.
   * Default: false (renders nothing while loading)
   */
  showLoading?: boolean;
  /**
   * Callback when database is ready (set up and unlocked).
   */
  onReady?: () => void;
}

/**
 * Inner component that handles auto-setup within the DatabaseProvider context.
 */
function AutoSetupWrapper({
  children,
  password,
  showLoading,
  onReady
}: {
  children: ReactNode;
  password: string;
  showLoading: boolean;
  onReady?: (() => void) | undefined;
}) {
  const { isLoading, isSetUp, isUnlocked, setup, unlock, error } =
    useDatabaseContext();
  const [setupComplete, setSetupComplete] = useState(false);

  useEffect(() => {
    async function autoSetupAndUnlock() {
      // Wait for initial loading to complete
      if (isLoading) return;

      try {
        if (!isSetUp) {
          // Database not set up yet - create new one
          await setup(password);
        } else if (!isUnlocked) {
          // Database exists but is locked - unlock it
          await unlock(password);
        }
        setSetupComplete(true);
        onReady?.();
      } catch (err) {
        console.error('Test database auto-setup failed:', err);
      }
    }

    autoSetupAndUnlock();
  }, [isLoading, isSetUp, isUnlocked, setup, unlock, password, onReady]);

  // Show error state
  if (error) {
    return (
      <div data-testid="test-database-error">
        Database Error: {error.message}
      </div>
    );
  }

  // Show loading state if requested
  if (!setupComplete) {
    if (showLoading) {
      return <div data-testid="test-database-loading">Loading database...</div>;
    }
    // Return null to prevent rendering children before database is ready
    return null;
  }

  return <>{children}</>;
}

/**
 * Test database provider that wraps DatabaseProvider with automatic setup/unlock.
 *
 * Usage:
 * ```tsx
 * <TestDatabaseProvider>
 *   <YourComponent />
 * </TestDatabaseProvider>
 * ```
 *
 * With options:
 * ```tsx
 * <TestDatabaseProvider
 *   autoSetup={true}
 *   password="custom-password"
 *   onReady={() => console.log('Database ready')}
 * >
 *   <YourComponent />
 * </TestDatabaseProvider>
 * ```
 */
export function TestDatabaseProvider({
  children,
  autoSetup = true,
  password = 'test-password',
  showLoading = false,
  onReady
}: TestDatabaseProviderProps) {
  if (autoSetup) {
    return (
      <DatabaseProvider>
        <AutoSetupWrapper
          password={password}
          showLoading={showLoading}
          onReady={onReady}
        >
          {children}
        </AutoSetupWrapper>
      </DatabaseProvider>
    );
  }

  // If autoSetup is false, just use the regular DatabaseProvider
  return <DatabaseProvider>{children}</DatabaseProvider>;
}
