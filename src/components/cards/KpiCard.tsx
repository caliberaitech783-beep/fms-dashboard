import type { ReactNode } from "react";
import type { KpiMetric } from "../../types/dashboard";
import { cx } from "../ui/cx";

interface KpiCardProps {
  metric: KpiMetric;
  icon?: ReactNode;
}

export function KpiCard({ metric, icon }: KpiCardProps) {
  return (
    <article className="rounded-lg border border-coal-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-coal-500">{metric.label}</p>
          <p className="mt-2 break-words text-2xl font-semibold text-coal-950">{metric.value}</p>
          {metric.subLabel && <p className="mt-1 text-xs text-coal-500">{metric.subLabel}</p>}
        </div>
        {icon && (
          <div
            className={cx(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-md border",
              metric.tone === "good" && "border-emerald-200 bg-emerald-50 text-emerald-700",
              metric.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700",
              metric.tone === "danger" && "border-red-200 bg-red-50 text-red-700",
              metric.tone === "info" && "border-blue-200 bg-blue-50 text-blue-700",
              (!metric.tone || metric.tone === "neutral") && "border-coal-200 bg-coal-50 text-coal-600",
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </article>
  );
}
