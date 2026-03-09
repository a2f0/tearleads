import { HealthWindow as BaseHealthWindow } from '@tearleads/app-health/clientEntry';
import type { ComponentProps } from 'react';
import { ClientHealthProvider } from '@/contexts/ClientHealthProvider';

type HealthWindowProps = ComponentProps<typeof BaseHealthWindow>;

export function HealthWindow(props: HealthWindowProps) {
  return (
    <ClientHealthProvider>
      <BaseHealthWindow {...props} />
    </ClientHealthProvider>
  );
}
