import { prepareScaniaStandstill, scaniaStandstillSummary } from "./scaniaStandstill.ts";
import type { ReportPreview } from "../types/reports";

type ReportValue = string | number | null;

export interface DriverwisePdfContext {
  company?: string;
  shift?: string;
}

interface DriverwisePdfRow {
  isSummary?: boolean;
  adjustedIdling: string;
  adjustedIdlingValue: number | null;
  registration: string;
  driver: string;
  engineRunningTime: string;
  engineMinutes: number | null;
  distanceKm: string;
  dieselEngineOnLitres: string;
  dieselEngineOnLitresValue: number | null;
  fuelKmPerLitre: string;
  fuelKmPerLitreValue: number | null;
  fuelLitres: string;
  fuelLitresPerHour: string;
  fuelLitresPerHourValue: number | null;
  idlingPercent: string;
  idlingPercentValue: number | null;
  idlingTime: string;
  iShiftPerformancePercent: string;
  aboveEconomyPercent: string;
  engineLoadPercent: string;
  engineLoadPercentValue: number | null;
  powerDistanceKm: string;
  powerDistanceKmValue: number | null;
  powerDistancePercent: string;
  powerDistancePercentValue: number | null;
  coastingPercent: string;
  coastingPercentValue: number | null;
}

type PdfSchema = "scania" | "volvo" | "volvo-extended";

interface PdfSchemaDefinition {
  columnWidths: number[];
  headerLines: string[][];
  thresholdLineOne: string;
  thresholdLineTwo: string;
}

const PAGE_WIDTH = 595.2756;
const PAGE_HEIGHT = 841.8898;
const TABLE_X = 89.14;
const TABLE_TOP = 54.84;
const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 11;
const ROWS_PER_PAGE = 62;
const SCANIA_SCHEMA: PdfSchemaDefinition = {
  columnWidths: [48, 40, 40, 43, 43, 43, 43, 33, 48, 44],
  headerLines: [
    ["Registratio", "n", "number"],
    ["Engine", "running", "time", "(h:m)"],
    ["Distanc", "e", "driven", "(km)"],
    ["Consump", "tion", "liquid fuel", "(km/l)"],
    ["Consum", "ption", "liquid", "fuel", "(litres)"],
    ["Consum", "ption", "liquid", "fuel", "(litres/h)"],
    ["Idling (%", "of", "engine", "running", "time)"],
    ["Idling", "(h:m)"],
    ["Powertrain", "coasting", "(% of", "distance)"],
    ["Adjusted", "Idling", "(%)"],
  ],
  thresholdLineOne: " km/l below fleet average = pink | L/h above fleet average = pink | adjusted idling > 28% = red | coasting < 20% = pink",
  thresholdLineTwo: "Adjusted idling = raw idling x min(L/h / fleet-average L/h, 1); estimated, not measured ignition-off time.",
};
const VOLVO_SCHEMA: PdfSchemaDefinition = {
  columnWidths: [36, 52, 35, 35, 36, 39, 36, 35, 42, 35, 36],
  headerLines: [
    ["Vehicles"],
    ["Drivers"],
    ["Total time", "(hh:mm)"],
    ["Driving", "(km)"],
    ["Diesel", "engine on", "(l)"],
    ["Avg diesel", "engine on", "(km/l)"],
    ["Standstill", "(%)"],
    ["Standstill", "(hh:mm)"],
    ["Engine load", "% time of", "Total time", "(%)"],
    ["Coasting", "(%)"],
    ["Avg diesel", "(l/h)"],
  ],
  thresholdLineOne: " rows under 00:30 engine time excluded | km/l below fleet average = light red | litres/h above fleet average = light red | standstill > 28% = red | engine load > 5% = red |",
  thresholdLineTwo: "coasting < 20% = light red | sorted by standstill % descending",
};
const VOLVO_EXTENDED_SCHEMA: PdfSchemaDefinition = {
  columnWidths: [44, 40, 28, 30, 30, 32, 29, 31, 29, 31, 34, 29, 31],
  headerLines: [
    ["Vehicles"],
    ["Drivers"],
    ["Total time", "(hh:mm)"],
    ["Driving", "(km)"],
    ["Diesel", "engine on", "(l)"],
    ["Avg diesel", "engine on", "(km/l)"],
    ["Standstill", "(%)"],
    ["Standstill", "(hh:mm)"],
    ["I-Shift", "performance", "(%)"],
    ["Above", "economy", "(%)"],
    ["Engine load", "% time of", "Total time", "(%)"],
    ["Coasting", "(%)"],
    ["Avg diesel", "(l/h)"],
  ],
  thresholdLineOne: VOLVO_SCHEMA.thresholdLineOne,
  thresholdLineTwo: VOLVO_SCHEMA.thresholdLineTwo,
};

export function isDriverwiseStandstillReport(reportType: string) {
  return reportType === "Driverwise Standstill Tracking" || reportType === "Driver wise Report";
}

export function buildDriverwiseStandstillPdf(
  preview: ReportPreview,
  context: DriverwisePdfContext = {},
) {
  const oem = resolveOem(preview, context);
  const schema: PdfSchema = oem.toLowerCase().includes("scania")
    || preview.columns.includes("Registration number")
    ? "scania"
    : preview.columns.includes("I-Shift Performance % time of Total time (%)")
      ? "volvo-extended"
      : "volvo";
  if (schema === "scania") preview = prepareScaniaStandstill(preview);
  const sourceRows = preview.rows.map(normalizeDriverwiseRow);
  const normalizedRows = sourceRows
    .filter((row) => schema === "scania" || row.engineMinutes === null || row.engineMinutes >= 30)
    .sort((left, right) => (right.idlingPercentValue ?? -Infinity) - (left.idlingPercentValue ?? -Infinity));
  const averages = {
    fuelKmPerLitre: average(normalizedRows.map((row) => row.fuelKmPerLitreValue)),
    fuelLitresPerHour: average(normalizedRows.map((row) => row.fuelLitresPerHourValue)),
  };
  const summaryRow = sourceRows.length
    ? schema === "scania"
      ? { ...normalizeDriverwiseRow(scaniaStandstillSummary(preview.rows)), isSummary: true }
      : buildVolvoSummaryRow(sourceRows, preview.summary)
    : null;
  const pages = paginateDriverwiseRows(normalizedRows, summaryRow);
  if (pages.length === 0) {
    pages.push([]);
  }

  const reportSite = preview.period?.site;
  const shift = preview.period?.shift || context.shift || "All";
  const title = `${oem} Vehicle Report | ${reportSite || "All Sites"} | ${shift === "All" || shift === "All Shifts" ? "All Shifts" : `Shift ${shift}`}`;
  const subtitle = buildPeriodSubtitle(preview, normalizedRows.length);
  const pageContents = pages.map((rows, pageIndex) => (
    buildPageContent(rows, pageIndex + 1, pages.length, title, subtitle, averages, schema)
  ));

  return assembleTablePdf(pageContents);
}

function buildVolvoSummaryRow(
  rows: DriverwisePdfRow[],
  explicitSummary?: ReportPreview["summary"],
): DriverwisePdfRow {
  if (explicitSummary) {
    return { ...normalizeDriverwiseRow(explicitSummary), isSummary: true };
  }
  const engineMinutes = rows.reduce((sum, row) => sum + (row.engineMinutes ?? 0), 0);
  const idlingMinutes = rows.reduce((sum, row) => sum + (durationToMinutes(row.idlingTime) ?? 0), 0);

  return {
    isSummary: true,
    adjustedIdling: "-",
    adjustedIdlingValue: null,
    registration: `Summary (${rows.length})`,
    driver: `${rows.length} vehicles`,
    engineRunningTime: durationText(null, engineMinutes),
    engineMinutes,
    distanceKm: numberText(total(rows.map((row) => toNumber(row.distanceKm)))),
    dieselEngineOnLitres: numberText(total(rows.map((row) => row.dieselEngineOnLitresValue))),
    dieselEngineOnLitresValue: null,
    fuelKmPerLitre: numberText(average(rows.map((row) => row.fuelKmPerLitreValue))),
    fuelKmPerLitreValue: null,
    fuelLitres: numberText(average(rows.map((row) => toNumber(row.fuelLitres)))),
    fuelLitresPerHour: numberText(average(rows.map((row) => row.fuelLitresPerHourValue))),
    fuelLitresPerHourValue: null,
    idlingPercent: numberText(average(rows.map((row) => row.idlingPercentValue))),
    idlingPercentValue: null,
    idlingTime: durationText(null, idlingMinutes),
    iShiftPerformancePercent: "-",
    aboveEconomyPercent: "-",
    engineLoadPercent: numberText(average(rows.map((row) => row.engineLoadPercentValue))),
    engineLoadPercentValue: null,
    powerDistanceKm: "-",
    powerDistanceKmValue: null,
    powerDistancePercent: "-",
    powerDistancePercentValue: null,
    coastingPercent: numberText(average(rows.map((row) => row.coastingPercentValue))),
    coastingPercentValue: null,
  };
}

function paginateDriverwiseRows(rows: DriverwisePdfRow[], summaryRow: DriverwisePdfRow | null) {
  if (!summaryRow) {
    return chunk(rows, ROWS_PER_PAGE);
  }

  const firstPageDetailCount = ROWS_PER_PAGE - 1;
  return [
    [summaryRow, ...rows.slice(0, firstPageDetailCount)],
    ...chunk(rows.slice(firstPageDetailCount), ROWS_PER_PAGE),
  ];
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
  const dieselEngineOnLitresValue = toNumber(getValue(row, [
    "Diesel engine on (l)",
    "Fuel consumed (litres)",
    "dieselEngineOnLitres",
    "fuelLitres",
  ]));
  const engineLoadPercentValue = toNumber(getValue(row, [
    "Engine load % time of Total time (%)",
    "engineLoadPercent",
  ]));
  const iShiftPerformancePercent = numberText(getValue(row, [
    "I-Shift Performance % time of Total time (%)",
    "iShiftPerformanceTimePercent",
  ]));
  const aboveEconomyPercent = numberText(getValue(row, [
    "Above economy % time of Total time (%)",
    "aboveEconomyPercent",
  ]));

  return {
    adjustedIdling: numberText(toNumber(row["Adjusted Idling (%)"])),
    adjustedIdlingValue: toNumber(row["Adjusted Idling (%)"]),
    registration: textValue(getValue(row, [
      "Registration number",
      "Vehicles",
      "vehicleNumber",
      "registrationNumber",
      "Vehicle",
    ]), "-"),
    driver: textValue(getValue(row, ["Drivers", "driverName", "Driver"]), "Unknown"),
    engineRunningTime: durationText(engineRunningTimeValue, engineMinutes),
    engineMinutes,
    distanceKm: numberText(distanceValue),
    dieselEngineOnLitres: numberText(dieselEngineOnLitresValue),
    dieselEngineOnLitresValue,
    fuelKmPerLitre: numberText(fuelKmPerLitreValue),
    fuelKmPerLitreValue,
    fuelLitres: numberText(derivedFuelLitres),
    fuelLitresPerHour: numberText(fuelLitresPerHourValue),
    fuelLitresPerHourValue,
    idlingPercent: numberText(idlingPercentValue),
    idlingPercentValue,
    idlingTime: durationText(idlingTimeValue, derivedIdlingMinutes),
    iShiftPerformancePercent,
    aboveEconomyPercent,
    engineLoadPercent: numberText(engineLoadPercentValue),
    engineLoadPercentValue,
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
  schema: PdfSchema,
) {
  const schemaDefinition = schema === "scania"
    ? SCANIA_SCHEMA
    : schema === "volvo-extended"
      ? VOLVO_EXTENDED_SCHEMA
      : VOLVO_SCHEMA;
  const { columnWidths, headerLines } = schemaDefinition;
  const commands: string[] = [
    "0 0 0 rg",
    textCommand(title, 2, 10, centeredX(title, 10, true), PAGE_HEIGHT - 36.08),
    textCommand(subtitle, 1, 7, centeredX(subtitle, 7, false), PAGE_HEIGHT - 45.29),
  ];
  const tableTopY = PAGE_HEIGHT - TABLE_TOP;
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const tableBottomY = tableTopY - HEADER_HEIGHT - rows.length * ROW_HEIGHT;

  commands.push("0.121569 0.305882 0.470588 rg");
  commands.push(`${decimal(TABLE_X)} ${decimal(tableTopY - HEADER_HEIGHT)} ${decimal(tableWidth)} ${HEADER_HEIGHT} re f`);

  rows.forEach((row, rowIndex) => {
    const rowTopY = tableTopY - HEADER_HEIGHT - rowIndex * ROW_HEIGHT;
    const fills = cellFills(row, averages, schema);
    let x = TABLE_X;
    fills.forEach((fill, columnIndex) => {
      if (fill) {
        commands.push(fill === "red" ? "1 0 0 rg" : "1 0.780392 0.807843 rg");
        commands.push(`${decimal(x)} ${decimal(rowTopY - ROW_HEIGHT)} ${columnWidths[columnIndex]} ${ROW_HEIGHT} re f`);
      }
      x += columnWidths[columnIndex];
    });
  });

  commands.push("0 0 0 RG", "0.4 w");
  let gridX = TABLE_X;
  commands.push(`${decimal(TABLE_X)} ${decimal(tableTopY)} m ${decimal(TABLE_X + tableWidth)} ${decimal(tableTopY)} l S`);
  commands.push(`${decimal(TABLE_X)} ${decimal(tableBottomY)} m ${decimal(TABLE_X + tableWidth)} ${decimal(tableBottomY)} l S`);
  columnWidths.forEach((width) => {
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
  headerLines.forEach((lines, columnIndex) => {
    const lineTop = TABLE_TOP + (HEADER_HEIGHT - lines.length * 6) / 2 + 4.52;
    lines.forEach((line, lineIndex) => {
      const lineWidth = measureText(line, 5.5, true);
      const x = headerX + (columnWidths[columnIndex] - lineWidth) / 2;
      const y = PAGE_HEIGHT - lineTop - lineIndex * 6;
      commands.push(textCommand(line, 2, 5.5, x, y));
    });
    headerX += columnWidths[columnIndex];
  });

  rows.forEach((row, rowIndex) => {
    const values = schema === "scania"
      ? [
        row.registration,
        row.engineRunningTime,
        row.distanceKm,
        row.fuelKmPerLitre,
        row.fuelLitres,
        row.fuelLitresPerHour,
        row.idlingPercent,
        row.idlingTime,
        row.coastingPercent,
        row.adjustedIdling,
      ]
      : schema === "volvo-extended"
        ? [
          row.registration,
          row.driver,
          row.engineRunningTime,
          row.distanceKm,
          row.dieselEngineOnLitres,
          row.fuelKmPerLitre,
          row.idlingPercent,
          row.idlingTime,
          row.iShiftPerformancePercent,
          row.aboveEconomyPercent,
          row.engineLoadPercent,
          row.coastingPercent,
          row.fuelLitresPerHour,
        ]
        : [
        row.registration,
        row.driver,
        row.engineRunningTime,
        row.distanceKm,
        row.dieselEngineOnLitres,
        row.fuelKmPerLitre,
        row.idlingPercent,
        row.idlingTime,
        row.engineLoadPercent,
        row.coastingPercent,
        row.fuelLitresPerHour,
      ];
    const baselineY = tableTopY - HEADER_HEIGHT - rowIndex * ROW_HEIGHT - 8.24;
    const font = row.isSummary ? 2 : 1;
    const fontSize = row.isSummary ? 5.1 : 6;
    const horizontalPadding = 6;
    commands.push(row.isSummary ? "0.121569 0.305882 0.470588 rg" : "0 0 0 rg");
    let cellX = TABLE_X;
    values.forEach((value, columnIndex) => {
      const cellFontSize = row.isSummary && columnIndex === 0 ? 4.5 : fontSize;
      commands.push(textCommand(
        fitText(value, columnWidths[columnIndex] - horizontalPadding - 1, cellFontSize, row.isSummary),
        font,
        cellFontSize,
        cellX + horizontalPadding,
        baselineY,
      ));
      cellX += columnWidths[columnIndex];
    });
  });

  if (pageNumber === pageCount) {
    const noteTop = TABLE_TOP + HEADER_HEIGHT + rows.length * ROW_HEIGHT + 6.24;
    const noteBaseline = PAGE_HEIGHT - noteTop - 4.92;
    commands.push(textCommand("Thresholds:", 2, 6, 25.84, noteBaseline));
    commands.push(textCommand(schemaDefinition.thresholdLineOne, 1, 6, 60.18, noteBaseline));
    commands.push(textCommand(schemaDefinition.thresholdLineTwo, 1, 6, 25.84, noteBaseline - 7));
  }

  const footer = `Page ${pageNumber}`;
  commands.push(textCommand(footer, 1, 6, 572.6 - measureText(footer, 6, false), 14.17));
  return commands.join("\n");
}

function cellFills(
  row: DriverwisePdfRow,
  averages: { fuelKmPerLitre: number | null; fuelLitresPerHour: number | null },
  schema: PdfSchema,
) {
  if (row.isSummary) {
    return Array.from({ length: schema === "volvo-extended" ? 13 : schema === "scania" ? 10 : 11 }, () => null);
  }
  if (schema === "volvo-extended") {
    return [
      null,
      null,
      null,
      null,
      null,
      row.fuelKmPerLitreValue !== null
        && averages.fuelKmPerLitre !== null
        && row.fuelKmPerLitreValue < averages.fuelKmPerLitre ? "pink" : null,
      row.idlingPercentValue !== null && row.idlingPercentValue > 28 ? "red" : null,
      null,
      null,
      null,
      row.engineLoadPercentValue !== null && row.engineLoadPercentValue > 5 ? "red" : null,
      row.coastingPercentValue !== null && row.coastingPercentValue < 20 ? "pink" : null,
      row.fuelLitresPerHourValue !== null
        && averages.fuelLitresPerHour !== null
        && row.fuelLitresPerHourValue > averages.fuelLitresPerHour ? "pink" : null,
    ];
  }
  if (schema === "volvo") {
    return [
      null,
      null,
      null,
      null,
      null,
      row.fuelKmPerLitreValue !== null
        && averages.fuelKmPerLitre !== null
        && row.fuelKmPerLitreValue < averages.fuelKmPerLitre ? "pink" : null,
      row.idlingPercentValue !== null && row.idlingPercentValue > 28 ? "red" : null,
      null,
      row.engineLoadPercentValue !== null && row.engineLoadPercentValue > 5 ? "red" : null,
      row.coastingPercentValue !== null && row.coastingPercentValue < 20 ? "pink" : null,
      row.fuelLitresPerHourValue !== null
        && averages.fuelLitresPerHour !== null
        && row.fuelLitresPerHourValue > averages.fuelLitresPerHour ? "pink" : null,
    ];
  }
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
    null,
    null,
    row.coastingPercentValue !== null && row.coastingPercentValue < 20 ? "pink" : null,
    row.adjustedIdlingValue !== null && row.adjustedIdlingValue > 28 ? "red" : null,
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

function total(values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function fitText(value: string, maxWidth: number, fontSize: number, bold = false) {
  if (measureText(value, fontSize, bold) <= maxWidth) {
    return value;
  }
  let shortened = value;
  while (shortened.length > 1 && measureText(`${shortened}...`, fontSize, bold) > maxWidth) {
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
