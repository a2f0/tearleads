import { configureSyncAuthDependencies } from '@/sync/configureSyncAuthDependencies';
import { configureSyncQueueDependencies } from '@/sync/configureSyncQueueDependencies';

configureSyncAuthDependencies();
configureSyncQueueDependencies();

export { SyncWindow } from '@tearleads/vfs-sync/clientEntry';
