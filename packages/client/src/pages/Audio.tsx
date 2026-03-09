import { ClientAudioProvider } from '@/contexts/ClientAudioProvider';
import { AudioWithSidebar } from './AudioWithSidebar';

export { AudioPage } from './AudioPage';

export function Audio() {
  return (
    <ClientAudioProvider>
      <AudioWithSidebar />
    </ClientAudioProvider>
  );
}
