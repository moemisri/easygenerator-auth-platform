import { Component, type ReactNode } from 'react';

import { Button } from '../components/Button';

type AppErrorBoundaryProps = {
  children: ReactNode;
  onReload?: (() => void) | undefined;
};

type AppErrorBoundaryState = { failed: boolean };

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch() {
    console.error('Unhandled application rendering error.');
  }

  private readonly reload = () => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="not-found">
        <div role="alert">
          <p className="eyebrow">Application recovery</p>
          <h1>Something went wrong.</h1>
          <p>Reload the application to start from a clean screen.</p>
        </div>
        <Button type="button" onClick={this.reload}>
          Reload application
        </Button>
      </main>
    );
  }
}
