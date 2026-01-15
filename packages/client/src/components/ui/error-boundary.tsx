import { X } from 'lucide-react';
import { Component, createRef, type ReactNode, type RefObject } from 'react';
import { logStore } from '@/stores/logStore';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export interface ErrorBoundaryHandle {
  setError: (error: Error) => void;
  clearError: () => void;
}

export const errorBoundaryRef: RefObject<ErrorBoundaryHandle | null> =
  createRef();

export class ErrorBoundary extends Component<Props, State> {
  private readonly handle: ErrorBoundaryHandle;

  constructor(props: Props) {
    super(props);
    this.state = { error: null };
    this.handle = {
      setError: this.setError,
      clearError: this.clearError
    };
  }

  override componentDidMount() {
    errorBoundaryRef.current = this.handle;
  }

  override componentWillUnmount() {
    if (errorBoundaryRef.current === this.handle) {
      errorBoundaryRef.current = null;
    }
  }

  static getDerivedStateFromError(error: Error): State {
    logStore.error(error.message, error.stack);
    return { error };
  }

  setError = (error: Error) => {
    logStore.error(error.message, error.stack);
    this.setState({ error });
  };

  clearError = () => {
    this.setState({ error: null });
  };

  override render() {
    return (
      <>
        {this.props.children}
        {this.state.error && (
          <div
            data-testid="error-boundary-bar"
            className="fixed right-0 bottom-0 left-0 flex items-center justify-between bg-destructive px-4 py-2 text-destructive-foreground text-sm"
          >
            <span>{this.state.error.message}</span>
            <button
              type="button"
              onClick={this.clearError}
              className="ml-4 rounded p-1 hover:bg-destructive/80"
              aria-label="Dismiss error"
              data-testid="error-boundary-dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </>
    );
  }
}
