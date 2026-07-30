import type { ReportPreview } from "../types/reports";

type ReportValue = string | number | null;

export interface DriverwisePdfContext {
  company?: string;
  shift?: string;
}

interface DriverwisePdfRow {
  registration: string;
  engineRunningTime: string;
  engineMinutes: number | null;
  distanceKm: string;
  fuelKmPerLitre: string;
  fuelKmPerLitreValue: number | null;
  fuelLitres: string;
  fuelLitresPerHour: string;
  fuelLitresPerHourValue: number | null;
  idlingPercent: string;
  idlingPercentValue: number | null;
  idlingTime: string;
  powerDistanceKm: string;
  powerDistanceKmValue: number | null;
  powerDistancePercent: string;
  powerDistancePercentValue: number | null;
  coastingPercent: string;
  coastingPercentValue: number | null;
}

const PAGE_WIDTH = 595.2756;
const PAGE_HEIGHT = 841.8898;
const TABLE_X = 89.14;
const TABLE_TOP = 54.84;
const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 11;
const ROWS_PER_PAGE = 62;
const COLUMN_WIDTHS = [43, 35, 34, 38, 36, 37, 39, 31, 39, 44, 41];
const HEADER_LINES = [
  ["Registratio", "n", "number"],
  ["Engine", "running", "time", "(h:m)"],
  ["Distanc", "e", "driven", "(km)"],
  ["Consump", "tion", "liquid fuel", "(km/l)"],
  ["Consum", "ption", "liquid", "fuel", "(litres)"],
  ["Consum", "ption", "liquid", "fuel", "(litres/h)"],
  ["Idling (%", "of", "engine", "running", "time)"],
  ["Idling", "(h:m)"],
  ["Performa", "nce", "mode -", "Power", "(km)"],
  ["Performanc", "e", "mode -", "Power", "(% of", "distance)"],
  ["Powertrain", "coasting", "(% of", "distance)"],
];
const THRESHOLD_LINE_ONE = " rows under 00:30 engine time excluded | km/l below fleet average = light red | litres/h above fleet average = light red | idling > 28% = red | Power distance > 30 km = red | Power share > 1% =";
const THRESHOLD_LINE_TWO = "light red | coasting < 20% = light red | sorted by idling % descending";

export function isDriverwiseStandstillReport(reportType: string) {
  return reportType === "Driverwise Standstill Tracking" || reportType === "Driver wise Report";
}

export function buildDriverwiseStandstillPdf(
  preview: ReportPreview,
  context: DriverwisePdfContext = {},
) {
  const normalizedRows = preview.rows
    .map(normalizeDriverwiseRow)
    .filter((row) => row.engineMinutes === null || row.engineMinutes >= 30)
    .sort((left, right) => (right.idlingPercentValue ?? -Infinity) - (left.idlingPercentValue ?? -Infinity));
  const averages = {
    fuelKmPerLitre: average(normalizedRows.map((row) => row.fuelKmPerLitreValue)),
    fuelLitresPerHour: average(normalizedRows.map((row) => row.fuelLitresPerHourValue)),
  };
  const pages = chunk(normalizedRows, ROWS_PER_PAGE);
  if (pages.length === 0) {
    pages.push([]);
  }

  const title = `${resolveOem(preview, context)} Vehicle Report | ${preview.period?.site || "All Sites"} | Shift ${preview.period?.shift || context.shift || "All"}`;
  const subtitle = buildPeriodSubtitle(preview, normalizedRows.length);
  const pageContents = pages.map((rows, pageIndex) => (
    buildPageContent(rows, pageIndex + 1, pages.length, title, subtitle, averages)
  ));

  return assembleTablePdf(pageContents);
}

function normalizeDriverwiseRow(row: Record<string, ReportValue>): DriverwisePdfRow {
  const engineRunningTimeValue = getValue(row, [
    "Engine running time (h:m)",
    "Total time (hh:mm)",
    "engineRunningTime",
    "totalTime",
    "runningTime",
  ]);
  const engineMinutes = durationToMinutes(engineRunningTimeValue);
  const fuelLitresPerHourValue = toNumber(getValue(row, [
    "Consumption liquid fuel (litres/h)",
    "Avg diesel (l/h)",
    "fuelLitresPerHour",
    "litresPerHour",
  ]));
  const fuelLitresSource = toNumber(getValue(row, [
    "Consumption liquid fuel (litres)",
    "fuelConsumedLitres",
    "fuelLitres",
  ]));
  const idlingPercentValue = toNumber(getValue(row, [
    "Idling (% of engine running time)",
    "Standstill (%)",
    "idlePercentage",
    "idlingPercentage",
  ]));
  const idlingTimeValue = getValue(row, [
    "Idling (h:m)",
    "Standstill (hh:mm)",
    "idleTime",
    "idlingTime",
  ]);
  const derivedFuelLitres = fuelLitresSource ?? (
    engineMinutes !== null && fuelLitresPerHourValue !== null
      ? fuelLitresPerHourValue * engineMinutes / 60
      : null
  );
  const derivedIdlingMinutes = durationToMinutes(idlingTimeValue) ?? (
    engineMinutes !== null && idlingPercentValue !== null
      ? engineMinutes * idlingPercentValue / 100
      : null
  );

  const distanceValue = getValue(row, ["Distance driven (km)", "Driving (km)", "distanceKm"]);
  const fuelKmPerLitreValue = toNumber(getValue(row, [
    "Consumption liquid fuel (km/l)",
    "Avg diesel engine on (km/l)",
    "efficiency",
    "fuelKmPerLitre",
  ]));
  const powerDistanceKmValue = toNumber(getValue(row, [
    "Performance mode - Power (km)",
    "powerDistanceKm",
  ])) ?? 0;
  const powerDistancePercentValue = toNumber(getValue(row, [
    "Performance mode - Power (% of distance)",
    "powerDistancePercent",
  ])) ?? 0;
  const coastingPercentValue = toNumber(getValue(row, [
    "Powertrain coasting (% of distance)",
    "Coasting (%)",
    "coastingPercent",
  ]));

  return {
    registration: textValue(getValue(row, [
      "Registration number",
      "Vehicles",
      "vehicleNumber",
      "registrationNumber",
      "Vehicle",
    ]), "-"),
    engineRunningTime: durationText(engineRunningTimeValue, engineMinutes),
    engineMinutes,
    distanceKm: numberText(distanceValue),
    fuelKmPerLitre: numberText(fuelKmPerLitreValue),
    fuelKmPerLitreValue,
    fuelLitres: numberText(derivedFuelLitres),
    fuelLitresPerHour: numberText(fuelLitresPerHourValue),
    fuelLitresPerHourValue,
    idlingPercent: numberText(idlingPercentValue),
    idlingPercentValue,
    idlingTime: durationText(idlingTimeValue, derivedIdlingMinutes),
    powerDistanceKm: numberText(powerDistanceKmValue),
    powerDistanceKmValue,
    powerDistancePercent: numberText(powerDistancePercentValue),
    powerDistancePercentValue,
    coastingPercent: numberText(coastingPercentValue),
    coastingPercentValue,
  };
}

function buildPageContent(
  rows: DriverwisePdfRow[],
  pageNumber: number,
  pageCount: number,
  title: string,
  subtitle: string,
  averages: { fuelKmPerLitre: number | null; fuelLitresPerHour: number | null },
) {
  const commands: string[] = [
    "0 0 0 rg",
    textCommand(title, 2, 10, centeredX(title, 10, true), PAGE_HEIGHT - 36.08),
    textCommand(subtitle, 1, 7, centeredX(subtitle, 7, false), PAGE_HEIGHT - 45.29),
  ];
  const tableTopY = PAGE_HEIGHT - TABLE_TOP;
  const tableWidth = COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0);
  const tableBottomY = tableTopY - HEADER_HEIGHT - rows.length * ROW_HEIGHT;

  commands.push("0.121569 0.305882 0.470588 rg");
  commands.push(`${decimal(TABLE_X)} ${decimal(tableTopY - HEADER_HEIGHT)} ${decimal(tableWidth)} ${HEADER_HEIGHT} re f`);

  rows.forEach((row, rowIndex) => {
    const rowTopY = tableTopY - HEADER_HEIGHT - rowIndex * ROW_HEIGHT;
    const fills = cellFills(row, averages);
    let x = TABLE_X;
    fills.forEach((fill, columnIndex) => {
      if (fill) {
        commands.push(fill === "red" ? "1 0 0 rg" : "1 0.780392 0.807843 rg");
        commands.push(`${decimal(x)} ${decimal(rowTopY - ROW_HEIGHT)} ${COLUMN_WIDTHS[columnIndex]} ${ROW_HEIGHT} re f`);
      }
      x += COLUMN_WIDTHS[columnIndex];
    });
  });

  commands.push("0 0 0 RG", "0.4 w");
  let gridX = TABLE_X;
  commands.push(`${decimal(TABLE_X)} ${decimal(tableTopY)} m ${decimal(TABLE_X + tableWidth)} ${decimal(tableTopY)} l S`);
  commands.push(`${decimal(TABLE_X)} ${decimal(tableBottomY)} m ${decimal(TABLE_X + tableWidth)} ${decimal(tableBottomY)} l S`);
  COLUMN_WIDTHS.forEach((width) => {
    commands.push(`${decimal(gridX)} ${decimal(tableBottomY)} m ${decimal(gridX)} ${decimal(tableTopY)} l S`);
    gridX += width;
  });
  commands.push(`${decimal(gridX)} ${decimal(tableBottomY)} m ${decimal(gridX)} ${decimal(tableTopY)} l S`);
  for (let rowIndex = 0; rowIndex <= rows.length; rowIndex += 1) {
    const y = tableTopY - HEADER_HEIGHT - rowIndex * ROW_HEIGHT;
    commands.push(`${decimal(TABLE_X)} ${decimal(y)} m ${decimal(TABLE_X + tableWidth)} ${decimal(y)} l S`);
  }

  commands.push("1 1 1 rg");
  let headerX = TABLE_X;
  HEADER_LINES.forEach((lines, columnIndex) => {
    const lineTop = TABLE_TOP + (HEADER_HEIGHT - lines.length * 6) / 2 + 4.52;
    lines.forEach((line, lineIndex) => {
      const lineWidth = measureText(line, 5.5, true);
      const x = headerX + (COLUMN_WIDTHS[columnIndex] - lineWidth) / 2;
      const y = PAGE_HEIGHT - lineTop - lineIndex * 6;
      commands.push(textCommand(line, 2, 5.5, x, y));
    });
    headerX += COLUMN_WIDTHS[columnIndex];
  });

  commands.push("0 0 0 rg");
  rows.forEach((row, rowIndex) => {
    const values = [
      row.registration,
      row.engineRunningTime,
      row.distanceKm,
      row.fuelKmPerLitre,
      row.fuelLitres,
      row.fuelLitresPerHour,
      row.idlingPercent,
      row.idlingTime,
      row.powerDistanceKm,
      row.powerDistancePercent,
      row.coastingPercent,
    ];
    const baselineY = tableTopY - HEADER_HEIGHT - rowIndex * ROW_HEIGHT - 8.24;
    let cellX = TABLE_X;
    values.forEach((value, columnIndex) => {
      commands.push(textCommand(fitText(value, COLUMN_WIDTHS[columnIndex] - 7, 6), 1, 6, cellX + 6, baselineY));
      cellX += COLUMN_WIDTHS[columnIndex];
    });
  });

  if (pageNumber === pageCount) {
    const noteTop = TABLE_TOP + HEADER_HEIGHT + rows.length * ROW_HEIGHT + 6.24;
    const noteBaseline = PAGE_HEIGHT - noteTop - 4.92;
    commands.push(textCommand("Thresholds:", 2, 6, 25.84, noteBaseline));
    commands.push(textCommand(THRESHOLD_LINE_ONE, 1, 6, 60.18, noteBaseline));
    commands.push(textCommand(THRESHOLD_LINE_TWO, 1, 6, 25.84, noteBaseline - 7));
  }

  const footer = `Page ${pageNumber}`;
  commands.push(textCommand(footer, 1, 6, 572.6 - measureText(footer, 6, false), 14.17));
  return commands.join("\n");
}

function cellFills(
  row: DriverwisePdfRow,
  averages: { fuelKmPerLitre: number | null; fuelLitresPerHour: number | null },
) {
  return [
    null,
    null,
    null,
    row.fuelKmPerLitreValue !== null
      && averages.fuelKmPerLitre !== null
      && row.fuelKmPerLitreValue < averages.fuelKmPerLitre ? "pink" : null,
    null,
    row.fuelLitresPerHourValue !== null
      && averages.fuelLitresPerHour !== null
      && row.fuelLitresPerHourValue > averages.fuelLitresPerHour ? "pink" : null,
    row.idlingPercentValue !== null && row.idlingPercentValue > 28 ? "red" : null,
    null,
    row.powerDistanceKmValue !== null && row.powerDistanceKmValue > 30 ? "red" : null,
    row.powerDistancePercentValue !== null && row.powerDistancePercentValue > 1 ? "pink" : null,
    row.coastingPercentValue !== null && row.coastingPercentValue < 20 ? "pink" : null,
  ];
}

function assembleTablePdf(pageContents: string[]) {
  const pageObjectIds = pageContents.map((_, index) => 5 + index * 2);
  const contentObjectIds = pageContents.map((_, index) => 6 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageContents.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  pageContents.forEach((content, pageIndex) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectIds[pageIndex]} 0 R >>`);
    objects.push(`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`);
  });

  return new TextEncoder().encode(assemblePdf(objects));
}

function assemblePdf(objects: string[]) {
  const encoder = new TextEncoder();
  const chunks = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  let byteLength = encoder.encode(chunks[0]).length;

  objects.forEach((object, index) => {
    offsets.push(byteLength);
    const serialized = `${index + 1} 0 obj\n${object}\nendobj\n`;
    chunks.push(serialized);
    byteLength += encoder.encode(serialized).length;
  });

  const xrefOffset = byteLength;
  chunks.push([
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
  ].join("\n"));
  return chunks.join("");
}

function resolveOem(preview: ReportPreview, context: DriverwisePdfContext) {
  const selectedCompany = context.company?.trim();
  if (selectedCompany && selectedCompany !== "All") {
    return selectedCompany;
  }
  const previewOem = preview.oem?.trim();
  if (previewOem && previewOem !== "All") {
    return previewOem;
  }
  if (preview.columns.includes("Registration number")) {
    return "Scania";
  }
  return "All OEMs";
}

function buildPeriodSubtitle(preview: ReportPreview, vehicleCount: number) {
  const start = preview.period?.start || preview.generatedAt;
  const end = preview.period?.end || preview.generatedAt;
  const timezone = preview.period?.timezone || "Asia/Kolkata";
  return `${formatPdfDateTime(start, timezone)} to ${formatPdfDateTime(end, timezone)} | Vehicles: ${vehicleCount}`;
}

function formatPdfDateTime(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return textValue(value, "-").replace("T", " ").slice(0, 17);
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("day")}-${part("month")}-${part("year")} ${part("hour")}:${part("minute")}`;
}

function getValue(row: Record<string, ReportValue>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function textValue(value: ReportValue | undefined, fallback = "") {
  return value === null || value === undefined || String(value).trim() === ""
    ? fallback
    : String(value).trim();
}

function toNumber(value: ReportValue | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value.replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function numberText(value: ReportValue | undefined) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return textValue(value, "-");
  }
  return numeric.toFixed(2);
}

function durationToMinutes(value: ReportValue | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value * 60;
  }
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(/^(\d+):(\d{1,2})$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function durationText(value: ReportValue | undefined, minutes: number | null) {
  if (typeof value === "string" && /^\d+:\d{1,2}$/.test(value.trim())) {
    const [hours, minutePart] = value.trim().split(":");
    return `${Number(hours)}:${minutePart.padStart(2, "0")}`;
  }
  if (minutes === null) {
    return textValue(value, "-");
  }
  const roundedMinutes = Math.max(0, Math.round(minutes));
  return `${Math.floor(roundedMinutes / 60)}:${String(roundedMinutes % 60).padStart(2, "0")}`;
}

function average(values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function fitText(value: string, maxWidth: number, fontSize: number) {
  if (measureText(value, fontSize, false) <= maxWidth) {
    return value;
  }
  let shortened = value;
  while (shortened.length > 1 && measureText(`${shortened}...`, fontSize, false) > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}...`;
}

function centeredX(value: string, fontSize: number, bold: boolean) {
  return (PAGE_WIDTH - measureText(value, fontSize, bold)) / 2;
}

function textCommand(value: string, font: 1 | 2, size: number, x: number, y: number) {
  return `BT /F${font} ${size} Tf 1 0 0 1 ${decimal(x)} ${decimal(y)} Tm (${escapePdfText(value)}) Tj ET`;
}

function escapePdfText(value: string) {
  return normalizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function normalizePdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trimEnd();
}

function decimal(value: number) {
  return Number(value.toFixed(3));
}

const REGULAR_WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, "\"": 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, "{": 334, "|": 260, "}": 334, "~": 584,
};

const BOLD_WIDTHS: Record<string, number> = {
  ...REGULAR_WIDTHS,
  A: 722, B: 722, C: 722, D: 722, J: 556, K: 722, L: 611, R: 722,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556,
};

function measureText(value: string, fontSize: number, bold: boolean) {
  const widths = bold ? BOLD_WIDTHS : REGULAR_WIDTHS;
  return [...normalizePdfText(value)].reduce((sum, character) => (
    sum + (/\d/.test(character) ? 556 : widths[character] ?? 556)
  ), 0) * fontSize / 1000;
}
