import { Health as BaseHealth } from '@tearleads/app-health/clientEntry';
import type { ComponentProps } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { ClientHealthProvider } from '@/contexts/ClientHealthProvider';

type HealthProps = ComponentProps<typeof BaseHealth>;

export function Health(props: HealthProps) {
  return (
    <ClientHealthProvider>
      <BaseHealth
        {...props}
        backLink={<BackLink defaultTo="/" defaultLabel="Back to Home" />}
      />
    </ClientHealthProvider>
  );
}
