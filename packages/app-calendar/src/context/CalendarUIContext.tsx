/**
 * Calendar UI Context for dependency injection.
 * Allows consumers to provide UI components and infrastructure dependencies.
 */

import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { CalendarEventItem, CreateCalendarEventInput } from '../types';

/**
 * Database state
 */
export interface DatabaseState {
  isUnlocked: boolean;
  isLoading: boolean;
}

/**
 * UI component props interfaces
 */
export interface ButtonProps {
  variant?:
    | 'default'
    | 'ghost'
    | 'destructive'
    | 'outline'
    | 'secondary'
    | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string | undefined;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  children?: ReactNode;
  title?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export interface InputProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  'data-testid'?: string;
}

export interface DropdownMenuProps {
  trigger: string;
  children: ReactNode;
}

export interface DropdownMenuItemProps {
  onClick: () => void;
  checked?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export type WindowOptionsMenuItemProps = Record<string, never>;

export interface AboutMenuItemProps {
  appName: string;
  version: string;
  closeLabel: string;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export interface ContextMenuItemProps {
  icon?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}

export interface InlineUnlockProps {
  description: string;
}

/**
 * UI components that the calendar package requires from the consumer
 */
export interface CalendarUIComponents {
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<InputProps>;
  Dialog: ComponentType<DialogProps>;
  DropdownMenu: ComponentType<DropdownMenuProps>;
  DropdownMenuItem: ComponentType<DropdownMenuItemProps>;
  WindowOptionsMenuItem: ComponentType<WindowOptionsMenuItemProps>;
  AboutMenuItem: ComponentType<AboutMenuItemProps>;
  ContextMenu: ComponentType<ContextMenuProps>;
  ContextMenuItem: ComponentType<ContextMenuItemProps>;
  InlineUnlock: ComponentType<InlineUnlockProps>;
}

/**
 * Translation keys used by the calendar package
 */
export type CalendarTranslationKey =
  | 'calendar'
  | 'newCalendar'
  | 'newItem'
  | 'close'
  | 'showContactBirthdays'
  | 'loadingDatabase'
  | 'calendarEvents'
  | 'cancel'
  | 'create';

/**
 * Translation function type
 */
export type TranslationFunction = (key: CalendarTranslationKey) => string;

/**
 * Calendar UI context value interface
 */
export interface CalendarUIContextValue {
  /** Database state */
  databaseState: DatabaseState;
  /** UI components */
  ui: CalendarUIComponents;
  /** Translation function */
  t: TranslationFunction;
  /** Fetch calendar events from the database */
  fetchEvents: () => Promise<CalendarEventItem[]>;
  /** Fetch birthday events from contacts */
  fetchBirthdayEvents: () => Promise<CalendarEventItem[]>;
  /** Create a new calendar event */
  createEvent: (input: CreateCalendarEventInput) => Promise<void>;
  /** Log an error */
  logError: (message: string, details?: string) => void;
}

const CalendarUIContext = createContext<CalendarUIContextValue | null>(null);

export interface CalendarUIProviderProps {
  children: ReactNode;
  databaseState: DatabaseState;
  ui: CalendarUIComponents;
  t: TranslationFunction;
  fetchEvents: () => Promise<CalendarEventItem[]>;
  fetchBirthdayEvents: () => Promise<CalendarEventItem[]>;
  createEvent: (input: CreateCalendarEventInput) => Promise<void>;
  logError: (message: string, details?: string) => void;
}

/**
 * Provider component that supplies all UI dependencies to calendar components
 */
export function CalendarUIProvider({
  children,
  databaseState,
  ui,
  t,
  fetchEvents,
  fetchBirthdayEvents,
  createEvent,
  logError
}: CalendarUIProviderProps) {
  const value = useMemo<CalendarUIContextValue>(
    () => ({
      databaseState,
      ui,
      t,
      fetchEvents,
      fetchBirthdayEvents,
      createEvent,
      logError
    }),
    [
      databaseState,
      ui,
      t,
      fetchEvents,
      fetchBirthdayEvents,
      createEvent,
      logError
    ]
  );

  return (
    <CalendarUIContext.Provider value={value}>
      {children}
    </CalendarUIContext.Provider>
  );
}

/**
 * Hook to access calendar UI context
 * @throws Error if used outside CalendarUIProvider
 */
export function useCalendarUIContext(): CalendarUIContextValue {
  const context = useContext(CalendarUIContext);
  if (!context) {
    throw new Error(
      'useCalendarUIContext must be used within a CalendarUIProvider'
    );
  }
  return context;
}

/**
 * Hook to access database state
 */
export function useCalendarDatabaseState(): DatabaseState {
  const { databaseState } = useCalendarUIContext();
  return databaseState;
}

/**
 * Hook to access UI components
 */
export function useCalendarUI(): CalendarUIComponents {
  const { ui } = useCalendarUIContext();
  return ui;
}
