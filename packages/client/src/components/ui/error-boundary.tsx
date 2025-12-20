import { Component, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

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
            className="fixed bottom-0 left-0 right-0 bg-red-600 px-4 py-2 text-sm text-white flex items-center justify-between"
          >
            <span>{this.state.error.message}</span>
            <button
              type="button"
              onClick={this.clearError}
              className="ml-4 p-1 hover:bg-red-700 rounded"
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
