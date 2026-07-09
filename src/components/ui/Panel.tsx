import type { ReactNode } from "react";
import { cx } from "./cx";

interface PanelProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}

export function Panel({ title, subtitle, children, className, actions }: PanelProps) {
  return (
    <section className={cx("rounded-lg border border-coal-200 bg-white shadow-sm", className)}>
      {(title || subtitle || actions) && (
        <div className="flex flex-col gap-3 border-b border-coal-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title && <h2 className="text-sm font-semibold text-coal-900">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-coal-500">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
