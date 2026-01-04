import { Link } from 'react-router-dom';
import { navItems } from '@/components/Sidebar';

export function Home() {
  // Filter out the home route itself and settings (keep it separate or at the end)
  const appItems = navItems.filter(
    (item) => item.path !== '/' && item.path !== '/settings'
  );
  const settingsItem = navItems.find((item) => item.path === '/settings');

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="grid w-full max-w-lg grid-cols-4 gap-4 px-4 sm:max-w-2xl sm:gap-6 md:max-w-3xl md:grid-cols-5 lg:max-w-4xl lg:grid-cols-6">
        {appItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex flex-col items-center gap-2"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/80 to-primary shadow-lg transition-transform hover:scale-105 active:scale-95 sm:h-16 sm:w-16">
                <Icon className="h-7 w-7 text-primary-foreground sm:h-8 sm:w-8" />
              </div>
              <span className="max-w-full truncate text-center text-foreground text-xs">
                {item.label}
              </span>
            </Link>
          );
        })}
        {settingsItem && (
          <Link
            to={settingsItem.path}
            className="flex flex-col items-center gap-2"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-muted-foreground/60 to-muted-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 sm:h-16 sm:w-16">
              <settingsItem.icon className="h-7 w-7 text-primary-foreground sm:h-8 sm:w-8" />
            </div>
            <span className="max-w-full truncate text-center text-foreground text-xs">
              {settingsItem.label}
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
