// ============================================================
// AppErrorBoundary — last-resort React error boundary.
//
// Why this exists: TanStack Router's own CatchBoundary stores the caught
// value and re-renders its children when the value is falsy. A thrown
// `undefined` (which the router itself can produce when a pending/redirected
// match is missing its internal promise) therefore re-renders the throwing
// tree, propagates through every route boundary, and unmounts the whole app
// into a blank screen ("Uncaught undefined").
//
// This class boundary tracks a boolean `hasError` flag instead of the error
// value, so it stays in the failed state and renders a fallback no matter
// what was thrown — Error, string, or `undefined`.
//
// Two placements:
//   - default ("app") variant wraps <Outlet /> inside the providers, so the
//     fallback is themed and resets automatically on navigation.
//   - "shell" variant wraps the root document children as a final safety net
//     with inline styles only, in case theming/i18n are what failed.
// ============================================================
import { Component, type ReactNode } from "react";
import i18n from "@/lib/i18n";
import { IS_DEV, userFacingErrorMessage } from "@/lib/error-message";
import { reportLovableError } from "@/lib/lovable-error-reporting";

type Props = {
  children: ReactNode;
  /** "shell" renders a dependency-free inline fallback for the root document. */
  variant?: "app" | "shell";
  /** When this changes while in the failed state, the boundary resets. */
  resetKey?: string;
};

type State = { hasError: boolean; message?: string };

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: userFacingErrorMessage(error, IS_DEV),
    };
  }

  override componentDidCatch(error: unknown) {
    // Preserve the raw value (may not be an Error) for Server/Client logs.
    console.error("[app-error-boundary]", error);
    reportLovableError(error ?? new Error("Unknown render error"), {
      boundary: "app_error_boundary",
    });
  }

  override componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: undefined });
    }
  }

  private handleReset = () => this.setState({ hasError: false, message: undefined });

  override render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.variant === "shell") {
      // Inline styles only — this renders when the app tree above may be broken.
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            background: "#0b1220",
            color: "#e5e7eb",
            fontFamily: "system-ui, -apple-system, sans-serif",
            padding: "1.5rem",
          }}
        >
          <div style={{ maxWidth: "28rem", textAlign: "center" }}>
            <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
              {safeT("error_page.this_page_didnt_load", "This page didn’t load")}
            </h1>
            <p style={{ color: "#9ca3af", margin: "0 0 1.5rem", fontSize: "0.875rem" }}>
              {this.state.message ??
                safeT(
                  "error_page.something_went_wrong_on_our_end_you_can",
                  "Something went wrong on our end.",
                )}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "1px solid #374151",
                background: "#111827",
                color: "#e5e7eb",
                cursor: "pointer",
              }}
            >
              {safeT("platform.common.reload", "Reload")}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-[60vh] grid place-items-center bg-background text-foreground p-6">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-semibold">{i18n.t("error_page.this_page_didnt_load")}</h1>
          <p className="text-sm text-muted-foreground mt-2 break-words">
            {this.state.message ?? i18n.t("error_page.something_went_wrong_on_our_end_you_can")}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-sm font-medium"
            >
              {i18n.t("error_page.try_again")}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-sm font-medium"
            >
              {i18n.t("platform.common.reload")}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/** The shell fallback renders when i18n itself may have failed: never throw here. */
function safeT(key: string, fallback: string): string {
  try {
    const v = i18n.t(key, { defaultValue: fallback });
    return typeof v === "string" && v && v !== key ? v : fallback;
  } catch {
    return fallback;
  }
}
