import type { ReactNode } from "react";
import { cx } from "./cx";

interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger" | "info";
  className?: string;
}

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
        tone === "neutral" && "border-coal-200 bg-coal-50 text-coal-700",
        tone === "good" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "danger" && "border-red-200 bg-red-50 text-red-700",
        tone === "info" && "border-blue-200 bg-blue-50 text-blue-700",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): "neutral" | "good" | "warning" | "danger" | "info" {
  if (["running", "connected", "healthy", "sent", "ready", "acknowledged"].includes(status)) return "good";
  if (["idle", "delayed", "pending", "queued", "maintenance"].includes(status)) return "warning";
  if (["offline", "failed", "critical", "unacknowledged", "locked"].includes(status)) return "danger";
  if (["info", "not_configured"].includes(status)) return "info";
  return "neutral";
}
