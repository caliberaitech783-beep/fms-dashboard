import type { ShiftCode } from "../types/fleet";

export const SHIFT_DEFINITIONS: Record<
  Extract<ShiftCode, "A" | "B" | "C">,
  { label: string; start: string; end: string }
> = {
  A: { label: "Shift A", start: "05:00", end: "13:00" },
  B: { label: "Shift B", start: "13:00", end: "21:00" },
  C: { label: "Shift C", start: "21:00", end: "05:00" },
};

export const SHIFT_OPTIONS = [
  { value: "All", label: "All Shifts" },
  { value: "A", label: "Shift A" },
  { value: "B", label: "Shift B" },
  { value: "C", label: "Shift C" },
  { value: "ALL_DAY", label: "All Day" },
  { value: "UNKNOWN", label: "Unknown" },
] as const;
