/** Limit an in-progress period to the instant the report is requested. */
export function reportGenerationPeriod(startTime: string, stopTime: string, now = new Date()) {
  const instant = now.getTime();
  return {
    startTime,
    stopTime: instant > Date.parse(startTime) && instant < Date.parse(stopTime)
      ? now.toISOString()
      : stopTime,
  };
}
