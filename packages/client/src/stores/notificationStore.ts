/**
 * Notification store for persistent user notifications.
 * Stores notifications in localStorage and provides a subscription API.
 */

export type NotificationLevel = 'info' | 'warning' | 'error' | 'success';

export interface Notification {
  id: string;
  timestamp: Date;
  level: NotificationLevel;
  title: string;
  message: string;
  read: boolean;
}

interface PersistedNotification {
  id: string;
  timestamp: string;
  level: NotificationLevel;
  title: string;
  message: string;
  read: boolean;
}

const STORAGE_KEY = 'rapid_notifications';
const MAX_NOTIFICATIONS = 50;

class NotificationStore {
  private notifications: Notification[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  add(level: NotificationLevel, title: string, message: string): void {
    const notification: Notification = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      level,
      title,
      message,
      read: false
    };

    this.notifications.unshift(notification);

    if (this.notifications.length > MAX_NOTIFICATIONS) {
      this.notifications = this.notifications.slice(0, MAX_NOTIFICATIONS);
    }

    this.saveToStorage();
    this.notifyListeners();
  }

  info(title: string, message: string): void {
    this.add('info', title, message);
  }

  warning(title: string, message: string): void {
    this.add('warning', title, message);
  }

  error(title: string, message: string): void {
    this.add('error', title, message);
  }

  success(title: string, message: string): void {
    this.add('success', title, message);
  }

  markAsRead(id: string): void {
    const notification = this.notifications.find((n) => n.id === id);
    if (notification && !notification.read) {
      notification.read = true;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  markAllAsRead(): void {
    let changed = false;
    for (const notification of this.notifications) {
      if (!notification.read) {
        notification.read = true;
        changed = true;
      }
    }
    if (changed) {
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  dismiss(id: string): void {
    const index = this.notifications.findIndex((n) => n.id === id);
    if (index !== -1) {
      this.notifications.splice(index, 1);
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  dismissAll(): void {
    if (this.notifications.length > 0) {
      this.notifications = [];
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  getNotifications(): Notification[] {
    return [...this.notifications];
  }

  getUnreadCount(): number {
    return this.notifications.filter((n) => !n.read).length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: PersistedNotification[] = JSON.parse(stored);
        this.notifications = parsed.map((n) => ({
          ...n,
          timestamp: new Date(n.timestamp)
        }));
      }
    } catch {
      this.notifications = [];
    }
  }

  private saveToStorage(): void {
    try {
      const toStore: PersistedNotification[] = this.notifications.map((n) => ({
        ...n,
        timestamp: n.timestamp.toISOString()
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // localStorage may not be available
    }
  }
}

export const notificationStore = new NotificationStore();
