import type { ExtendedFuelMeasurementUnit } from "../types/fleet";

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatLitres(value: number | null | undefined): string {
  return `${formatNumber(value, value && value < 100 ? 1 : 0)} L`;
}

export function formatHours(value: number | null | undefined): string {
  return `${formatNumber(value, 1)} hr`;
}

export function formatKm(value: number | null | undefined): string {
  return `${formatNumber(value, 1)} km`;
}

export function formatM3(value: number | null | undefined): string {
  return `${formatNumber(value, 0)} m³`;
}

export function formatPercent(value: number | null | undefined): string {
  return `${formatNumber(value, 1)}%`;
}

export function formatEfficiency(
  value: number | null | undefined,
  unit: ExtendedFuelMeasurementUnit,
): string {
  if (value === null || value === undefined || Number.isNaN(value) || unit === "Unknown") {
    return "-";
  }

  return `${formatNumber(value, 2)} ${unit}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function titleCase(value: string): string {
  return value
    .split("_")
    .join(" ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function makeCsvFileName(reportType: string, site: string, shift: string, date: string): string {
  const reportName = reportType.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const sitePart = site.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "all_sites";
  const shiftPart = shift.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "all_shifts";
  const datePart = date || new Date().toISOString().slice(0, 10);

  return `${reportName}_${sitePart}_${shiftPart}_${datePart}.csv`;
}
