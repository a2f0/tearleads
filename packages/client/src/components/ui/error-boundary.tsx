import { X } from 'lucide-react';
import { Component, createRef, type ReactNode, type RefObject } from 'react';

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
    return { error };
  }

  setError = (error: Error) => {
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
            className="fixed right-0 bottom-0 left-0 flex items-center justify-between bg-red-600 px-4 py-2 text-sm text-white"
          >
            <span>{this.state.error.message}</span>
            <button
              type="button"
              onClick={this.clearError}
              className="ml-4 rounded p-1 hover:bg-red-700"
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
