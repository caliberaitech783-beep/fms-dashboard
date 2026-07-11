import { X } from "lucide-react";
import { useEffect } from "react";
import { formatElapsedSeconds } from "../../utils/formatters";

interface TimingToastProps {
  elapsedMs: number;
  message: string;
  onClose: () => void;
}

export function TimingToast({ elapsedMs, message, onClose }: TimingToastProps) {
  useEffect(() => {
    const timeoutId = window.setTimeout(onClose, 3500);
    return () => window.clearTimeout(timeoutId);
  }, [elapsedMs, message, onClose]);

  return (
    <div
      className="fixed bottom-20 right-4 z-[70] max-w-sm rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 shadow-command lg:bottom-5 lg:right-5"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">
          {message}. Time taken: {formatElapsedSeconds(elapsedMs)}.
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss status"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-emerald-800 hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
