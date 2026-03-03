interface SetupStep {
  label: string;
  progress: number;
}

class DatabaseSetupProgressStore {
  private currentStep: SetupStep | null = null;
  private active = false;
  private listeners: Set<() => void> = new Set();

  get isActive(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
    this.currentStep = { label: 'Initializing...', progress: 0 };
    this.notifyListeners();
  }

  update(label: string, progress: number): void {
    this.currentStep = {
      label,
      progress: Math.max(0, Math.min(100, progress))
    };
    this.notifyListeners();
  }

  finish(): void {
    this.active = false;
    this.currentStep = null;
    this.notifyListeners();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): SetupStep | null {
    return this.currentStep;
  }

  getIsActive(): boolean {
    return this.active;
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const databaseSetupProgressStore = new DatabaseSetupProgressStore();
