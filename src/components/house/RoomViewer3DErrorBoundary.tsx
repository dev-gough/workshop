'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class RoomViewer3DErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('3D Viewer Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bp-paper flex h-full w-full items-center justify-center" style={{ minHeight: 420 }}>
          <div className="text-center">
            <p className="bp-etch mb-2" style={{ color: 'var(--bp-accent)' }}>
              3D viewer unavailable
            </p>
            <p className="text-[11px] text-muted-foreground">
              WebGL may not be supported in this browser.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
