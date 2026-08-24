import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Swallow the benign "ResizeObserver loop completed with undelivered
// notifications" warning that Chrome dispatches as an uncaught `error` event
// (with no Error object attached). Many of our UI primitives — Radix
// popovers, recharts, sticky tables, the agreement signature pad on
// reflow — trigger it harmlessly during layout. Without this filter the
// Replit dev overlay surfaces the warning as a runtime crash even though
// the app itself is fine. We intentionally only suppress this exact
// notification, every other error still propagates normally.
if (typeof window !== "undefined") {
  const RESIZE_LOOP_RE = /^ResizeObserver loop (limit exceeded|completed with undelivered notifications)/;
  window.addEventListener("error", (e) => {
    if (e?.message && RESIZE_LOOP_RE.test(e.message)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg =
      typeof e.reason === "string"
        ? e.reason
        : e.reason && typeof e.reason === "object" && "message" in e.reason
          ? String((e.reason as { message?: unknown }).message ?? "")
          : "";
    if (RESIZE_LOOP_RE.test(msg)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
