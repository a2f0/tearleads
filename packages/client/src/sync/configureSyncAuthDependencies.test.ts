import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('configureSyncAuthDependencies', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('configures sync auth dependencies only once', async () => {
    const setSyncAuthDependencies = vi.fn();
    const LoginForm = () => null;
    const RegisterForm = () => null;
    const SessionList = () => null;
    const useAuth = vi.fn();
    const ping = vi.fn(async () => ({ emailDomain: 'example.com' }));

    vi.doMock('@tearleads/vfs-sync', () => ({
      setSyncAuthDependencies
    }));
    vi.doMock('@/components/auth', () => ({
      LoginForm,
      RegisterForm
    }));
    vi.doMock('@/components/sessions', () => ({
      SessionList
    }));
    vi.doMock('@/contexts/AuthContext', () => ({
      useAuth
    }));
    vi.doMock('@/lib/api', () => ({
      api: {
        ping: { get: ping }
      }
    }));

    const { configureSyncAuthDependencies } = await import(
      './configureSyncAuthDependencies'
    );

    configureSyncAuthDependencies();
    configureSyncAuthDependencies();

    expect(setSyncAuthDependencies).toHaveBeenCalledTimes(1);
    expect(setSyncAuthDependencies).toHaveBeenCalledWith({
      useAuth,
      LoginForm,
      RegisterForm,
      SessionList,
      ping
    });
  });
});
