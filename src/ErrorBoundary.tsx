import React from "react";

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: ""
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : "Unknown runtime error";
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown): void {
    // Keep runtime details in console for post-deploy debugging.
    console.error("App runtime error:", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          maxWidth: 720,
          margin: "40px auto",
          padding: 16,
          border: "1px solid rgba(210,60,60,0.35)",
          borderRadius: 10,
          background: "rgba(22, 27, 34, 0.92)",
          color: "#e6edf3"
        }}
      >
        <h2 style={{ marginTop: 0 }}>Ошибка загрузки приложения</h2>
        <p style={{ marginBottom: 8 }}>
          После деплоя произошла runtime-ошибка. Попробуйте обновить страницу.
        </p>
        <p style={{ opacity: 0.8, marginTop: 0 }}>Детали: {this.state.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            cursor: "pointer",
            background: "linear-gradient(135deg, #b92b2b, #d23c3c)",
            color: "#fff",
            fontWeight: 600
          }}
        >
          Обновить страницу
        </button>
      </div>
    );
  }
}
