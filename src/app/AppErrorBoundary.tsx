import { Component, type ErrorInfo, type ReactNode } from "react";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Echo could not render the current page.", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-recovery-fallback" role="alert">
      <section className="app-recovery-card">
        <strong>Echo</strong>
        <h1>This page could not open</h1>
        <p>Your profile and saved work are untouched. Reload this page or return to Echo.</p>
        <div>
          <button onClick={() => window.location.reload()} type="button">Reload Echo</button>
          <a href={import.meta.env.BASE_URL}>Open Echo</a>
        </div>
      </section>
    </main>;
  }
}
