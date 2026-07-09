import { Inbox } from "lucide-react";

interface EmptyStateProps {
  title: string;
  message: string;
}

export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-md border border-dashed border-coal-200 bg-coal-50 p-6 text-center">
      <Inbox className="h-8 w-8 text-coal-400" />
      <p className="mt-3 text-sm font-semibold text-coal-800">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-coal-500">{message}</p>
    </div>
  );
}
