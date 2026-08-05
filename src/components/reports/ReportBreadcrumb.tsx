import { ChevronRight } from "lucide-react";

export interface ReportBreadcrumbItem {
  label: string;
  route?: string;
}

interface ReportBreadcrumbProps {
  items: ReportBreadcrumbItem[];
  onNavigate: (route: string) => void;
}

export function ReportBreadcrumb({ items, onNavigate }: ReportBreadcrumbProps) {
  return (
    <nav aria-label="Report breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-coal-500">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 && <ChevronRight aria-hidden="true" className="h-4 w-4 text-coal-400" />}
          {item.route ? (
            <button
              type="button"
              onClick={() => onNavigate(item.route!)}
              className="rounded px-1 py-0.5 font-medium text-ore-700 hover:bg-ore-50 hover:text-ore-800"
            >
              {item.label}
            </button>
          ) : (
            <span aria-current="page" className="px-1 py-0.5 font-medium text-coal-800">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
