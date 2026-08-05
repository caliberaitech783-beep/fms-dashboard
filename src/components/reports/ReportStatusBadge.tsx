import { LoaderCircle } from "lucide-react";
import type { ReportStatus } from "../../types/reportCategories";
import { Badge } from "../ui/Badge";

const STATUS_LABELS: Record<ReportStatus, string> = {
  ready: "Ready",
  queued: "Queued",
  processing: "Processing",
  failed: "Failed",
  not_generated: "Not Generated",
};

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const tone = status === "ready"
    ? "good"
    : status === "queued"
      ? "warning"
      : status === "processing"
        ? "info"
        : status === "failed"
          ? "danger"
          : "neutral";

  return (
    <Badge tone={tone}>
      {status === "processing" && <LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />}
      {STATUS_LABELS[status]}
    </Badge>
  );
}
