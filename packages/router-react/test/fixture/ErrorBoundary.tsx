import * as React from "react"

/** An application-owned boundary; resetting it does not retry router gates. */
export class ErrorBoundary extends React.Component<
  {
    readonly children: React.ReactNode
    readonly fallback: (reset: () => void) => React.ReactNode
  },
  { readonly failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children
  }
}
