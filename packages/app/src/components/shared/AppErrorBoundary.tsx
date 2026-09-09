import { Component, type PropsWithChildren } from "react";
import type { AppDiagnostics, DiagnosticArea } from "../../host/AppDiagnostics";
import "../mini-app/controls/MiniAppStatus.css";

interface Props extends PropsWithChildren {
  area: DiagnosticArea;
  diagnostics?: AppDiagnostics | undefined;
  onRetry?: (() => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
  resetKey?: string | undefined;
}

export class AppErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override componentDidCatch(error: unknown) {
    try {
      this.props.onError?.(error);
    } catch {
      // Local logging must not prevent reporting or recovery either.
    }
    try {
      this.props.diagnostics?.captureError(error, {
        area: this.props.area,
        source: "boundary",
      });
    } catch {
      // A diagnostics outage must not replace the recovery UI.
    }
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mini-app-status">
        <p>Something went wrong while displaying this view.</p>
        <button
          type="button"
          onClick={() => {
            this.props.onRetry?.();
            this.setState({ failed: false });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
