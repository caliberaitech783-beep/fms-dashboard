import type { ShiftCode } from "../types/fleet";

export function getShiftFromTimestamp(timestamp: string): ShiftCode {
  const hour = new Date(timestamp).getHours();

  if (hour >= 5 && hour < 13) {
    return "A";
  }

  if (hour >= 13 && hour < 21) {
    return "B";
  }

  return "C";
}
