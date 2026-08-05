import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Portal view failed", { name: error.name, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-coal-50 p-4">
        <section className="w-full max-w-lg rounded-lg border border-red-200 bg-white p-6 shadow-command" role="alert">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700">
              <AlertTriangle aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-coal-950">This view could not be displayed</h1>
              <p className="mt-2 text-sm text-coal-600">
                Your session and saved data were not changed. Reload the portal to retry with a clean view.
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={() => window.location.reload()}>Reload portal</Button>
          </div>
        </section>
      </main>
    );
  }
}
