import type { NamedMetric } from "../types/dashboard";

export function withModelEfficiency(metric: NamedMetric, category: string): NamedMetric {
  const truck = category === "Truck";
  const numerator = truck ? metric.distanceKm : metric.fuelConsumedLitres;
  const denominator = truck ? metric.fuelConsumedLitres : metric.runningHours;
  return {
    ...metric,
    efficiencyUnit: truck ? "km/L" : "L/hr",
    efficiency: numerator != null && denominator != null && denominator > 0
      ? numerator / denominator
      : null,
  };
}
