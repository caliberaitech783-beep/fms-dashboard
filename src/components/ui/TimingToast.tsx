import { useEffect, useRef } from "react";
import { formatElapsedSeconds } from "../../utils/formatters";

interface TimingToastProps {
  elapsedMs: number;
  message: string;
  onClose: () => void;
}

export function TimingToast({ elapsedMs, message, onClose }: TimingToastProps) {
  const okButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    okButtonRef.current?.focus();
  }, [elapsedMs, message]);

  return (
    <div
      className="fixed left-1/2 top-6 z-[70] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg bg-emerald-700 px-5 py-4 text-white shadow-command sm:px-9 sm:py-6"
      role="status"
      aria-live="polite"
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-lg font-semibold sm:text-2xl">
          {message}. Time taken: {formatElapsedSeconds(elapsedMs)}.
        </p>
        <button
          ref={okButtonRef}
          type="button"
          onClick={onClose}
          className="h-14 rounded-md bg-white px-7 text-lg font-semibold text-coal-950 shadow-sm transition hover:bg-coal-50 focus:outline-none focus:ring-2 focus:ring-white/80 focus:ring-offset-2 focus:ring-offset-emerald-700"
        >
          OK
        </button>
      </div>
    </div>
  );
}
