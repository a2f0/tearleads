import { LoginForm, RegisterForm } from '@/components/auth';
import { SessionList } from '@/components/sessions';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import {
  type SyncAuthDependencies,
  setSyncAuthDependencies
} from '../../../vfs-sync/src';

let configured = false;

function createDependencies(): SyncAuthDependencies {
  return {
    useAuth,
    LoginForm,
    RegisterForm,
    SessionList,
    ping: api.ping.get
  };
}

export function configureSyncAuthDependencies(): void {
  if (configured) {
    return;
  }

  setSyncAuthDependencies(createDependencies());
  configured = true;
}
