import { EmptyState } from "../ui/EmptyState";

interface EmptyReportStateProps {
  filtered?: boolean;
}

export function EmptyReportState({ filtered = false }: EmptyReportStateProps) {
  return (
    <EmptyState
      title={filtered ? "No matching reports" : "No reports available"}
      message={filtered
        ? "Change the search text or status filter to see more reports."
        : "No reports are configured for this category or your current permissions."}
    />
  );
}
