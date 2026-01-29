// Components
export { EmailWindow, EmailWindowMenuBar, type ViewMode } from './components';

// Context
export {
  type BackLinkProps,
  type DropdownMenuItemProps,
  type DropdownMenuProps,
  type DropdownMenuSeparatorProps,
  type EmailContextValue,
  EmailProvider,
  type EmailProviderProps,
  type EmailUIComponents,
  type RefreshButtonProps,
  useEmailApi,
  useEmailContext,
  useEmailUI,
  type WindowOptionsMenuItemProps
} from './context';

// Lib
export { type EmailItem, formatEmailDate, formatEmailSize } from './lib';

// Pages
export { Email } from './pages';
