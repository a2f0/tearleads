import { Link } from 'react-router-dom';
import { navItems } from '@/components/Sidebar';
import { useTypedTranslation } from '@/i18n';

export function Home() {
  const { t } = useTypedTranslation('menu');
  // Filter out the home route itself, keep settings at the end
  const appItems = navItems.filter((item) => item.path !== '/');

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="grid w-full max-w-lg grid-cols-4 gap-4 px-4 sm:max-w-2xl sm:gap-6 md:max-w-3xl md:grid-cols-5 lg:max-w-4xl lg:grid-cols-6">
        {appItems.map((item) => {
          const Icon = item.icon;
          const isSettings = item.path === '/settings';
          const bgClasses = isSettings
            ? 'bg-muted-foreground from-muted-foreground/60 to-muted-foreground'
            : 'bg-primary from-primary/80 to-primary';

          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex flex-col items-center gap-2"
            >
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${bgClasses} shadow-lg transition-transform hover:scale-105 active:scale-95 sm:h-16 sm:w-16`}
              >
                <Icon className="h-7 w-7 text-primary-foreground sm:h-8 sm:w-8" />
              </div>
              <span className="max-w-full truncate text-center text-foreground text-xs">
                {t(item.labelKey)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
