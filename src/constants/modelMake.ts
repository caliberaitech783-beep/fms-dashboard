interface CatalogModel {
  name: string;
  aliases?: readonly string[];
}

type ModelMakeMatrix = Record<string, Record<string, readonly CatalogModel[]>>;

const model = (name: string, aliases: readonly string[] = []): CatalogModel => ({
  name,
  aliases,
});

// Source: "Model & Make.xlsx", second worksheet "Sheet1".
// Model names intentionally preserve the workbook's spelling and punctuation.
const MODEL_MAKE_MATRIX: ModelMakeMatrix = {
  Tipper: {
    Eicher: [
      model("2110"),
      model("PRO8035L", ["PRO8035XM", "PRO 8035XM"]),
    ],
    Scania: [
      model("440 BS III", ["G440", "SCANIA G440"]),
      model("SCANIA G 500 XT BS VI", ["G500", "SCANIA G500", "G 500"]),
    ],
    Volvo: [
      model("VOLVO FMX460 8X4E", [
        "FM (4)",
        "FMX 460",
        "FMX460",
        "FMX460 8X4E",
        "FMX1384R",
        "Volvo FMX1384R",
      ]),
      model("VOLVO FMX500E", [
        "FMX 500",
        "FMX500",
        "FMX500E",
        "FMXB384R",
        "Volvo FMXB384R",
      ]),
    ],
    Tata: [
      model("TATA 4018 TIPPER"),
      model("PRIMA LX", ["PRIMALX"]),
      model("TATA SIGNA 2823"),
    ],
    Propel: [
      model("PROPEL 470 HEV."),
    ],
  },
  "Haul Pack": {
    LiuGong: [
      model("LIUGONG DW105A", ["DW105A"]),
    ],
    Sany: [
      model("SANY SKT 105S", ["SKT105", "SKT 105"]),
    ],
  },
  "Water Tanker": {
    Eicher: [
      model("EICHER PRO 6035"),
      model("EICHER PRO 6028", ["PRO 6028T", "PRO6028T"]),
      model("PRO8035L", ["PRO8035XM", "PRO 8035XM"]),
    ],
    Tata: [
      model("2518 C"),
      model("TATA SIGNA 3718.TK"),
      model("4018"),
      model("TATA SIGNA 2825"),
      model("SIGNA 3523"),
      model("SIGNA 3530"),
    ],
  },
  Dozer: {
    Dozco: [
      model("SHANTUI DH24C3", ["DH24C3"]),
    ],
    Komatsu: [
      model("KOMATSU D85ESS-2", ["D85"]),
      model("KOMATSU D155A-6R"),
    ],
    Liebherr: [
      model("LIEBHERR PR-736", ["PR736"]),
    ],
    LiuGong: [
      model("LIUGONG CLGB230", ["B230"]),
      model("LIUGONG LD20D", ["LD20D"]),
      model("LIUGONG LGCB160C", ["B160", "CLGB160", "LGCB160"]),
    ],
  },
  Drill: {
    LiuGong: [
      model("LIUGONG CLG921D", ["CLG921"]),
      model("LIUGONG CLG921L"),
      model("LIUGONG CLG922E", ["CLG922E"]),
      model("LIUGONG CLG924E"),
    ],
  },
  Grader: {
    Case: [
      model("CASE 865C", ["CASE865C"]),
    ],
    Caterpillar: [
      model("140GC", ["CAT140GC"]),
    ],
    LiuGong: [
      model("CLG4180D"),
      model("CLG4215D"),
      model("CLG4230 D", ["CLG4230D", "CLG423OD"]),
    ],
  },
  "Surface Miner": {
    "L&T": [
      model("KSM403"),
    ],
  },
  Payloader: {
    "Caterpillar Inc.": [
      model("2021D"),
    ],
    "Escorts Kubota Limited": [
      model("JCB 1742563"),
    ],
    JCB: [
      model("JCB 1742563"),
      model("JCB437-4"),
      model("JCB455-4"),
    ],
    LiuGong: [
      model("LIUGONG CLG836H"),
      model("LIUGONG CLG838TE"),
      model("LIUGONG CLG848H"),
      model("LIUGONG CLG856H", ["CLG856H"]),
      model("LIUGONG CLG856H MAX", ["CLG856H MAX"]),
    ],
    "Tata Hitachi": [
      model("TATA HITACHI ZW225-6", ["ZW 225", "ZW225"]),
    ],
    Volvo: [
      model("SDLG L958H", ["SDLGL958H", "L958H"]),
    ],
  },
};

const PORTAL_TYPE_TO_CATALOG_TYPES: Record<string, readonly string[]> = {
  Truck: ["Tipper", "Water Tanker"],
  Tipper: ["Tipper"],
  Dumper: ["Tipper", "Haul Pack"],
  "Haul Pack": ["Haul Pack"],
  Haulpack: ["Haul Pack"],
  Loader: ["Payloader"],
  Payloader: ["Payloader"],
  Grader: ["Grader"],
  Crane: ["Crane"],
  Other: ["Dozer", "Drill", "Surface Miner"],
  Dozer: ["Dozer"],
  Drill: ["Drill"],
  "Surface Miner": ["Surface Miner"],
};

const MAKE_ALIASES: Record<string, string> = {
  VOLVOTRUCKS: "Volvo",
  VOLVO: "Volvo",
  SCANIA: "Scania",
  EICHER: "Eicher",
  TATA: "Tata",
  TATAHITACHI: "Tata Hitachi",
  LIUGONG: "LiuGong",
  SANY: "Sany",
  PROPEL: "Propel",
  DOZCO: "Dozco",
  SHANTUI: "Dozco",
  KOMATSU: "Komatsu",
  LIEBHERR: "Liebherr",
  CASE: "Case",
  CAT: "Caterpillar",
  CATERPILLAR: "Caterpillar",
  CATERPILLARINC: "Caterpillar Inc.",
  ESCORTSKUBOTALIMITED: "Escorts Kubota Limited",
  JCB: "JCB",
  LT: "L&T",
};

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function catalogTypes(assetType: string | null | undefined): readonly string[] {
  if (!assetType) return [];
  return PORTAL_TYPE_TO_CATALOG_TYPES[assetType] ?? [assetType];
}

function uniqueInWorkbookOrder(values: string[]): string[] {
  return [...new Set(values)];
}

function configuredMakesForTypes(types: readonly string[]): string[] {
  return uniqueInWorkbookOrder(types.flatMap((type) => Object.keys(MODEL_MAKE_MATRIX[type] ?? {})));
}

function resolveConfiguredMake(types: readonly string[], rawMake: string): string | null {
  const configuredMakes = configuredMakesForTypes(types);
  const normalizedRawMake = normalizeKey(rawMake);
  const alias = MAKE_ALIASES[normalizedRawMake];
  return configuredMakes.find((make) => normalizeKey(make) === normalizeKey(alias ?? rawMake)) ?? null;
}

function modelKey(value: string, make: string): string {
  let key = normalizeKey(value);
  const makeKeys = uniqueInWorkbookOrder([
    normalizeKey(make),
    ...Object.entries(MAKE_ALIASES)
      .filter(([, canonical]) => normalizeKey(canonical) === normalizeKey(make))
      .map(([alias]) => alias),
  ]).sort((left, right) => right.length - left.length);

  for (const makePrefix of makeKeys) {
    if (makePrefix && key.startsWith(makePrefix)) {
      key = key.slice(makePrefix.length);
      break;
    }
  }
  return key;
}

export function getConfiguredMakes(assetType: string): string[] | null {
  const makes = configuredMakesForTypes(catalogTypes(assetType));
  return makes.length ? makes : null;
}

export function getConfiguredModels(assetType: string, company: string): string[] | null {
  const types = catalogTypes(assetType);
  if (!types.length) return null;

  if (!company || company === "All") {
    const models = types.flatMap((type) => Object.values(MODEL_MAKE_MATRIX[type] ?? {})
      .flatMap((entries) => entries.map((entry) => entry.name)));
    return models.length ? uniqueInWorkbookOrder(models) : null;
  }

  const configuredMake = resolveConfiguredMake(types, company);
  if (!configuredMake) return null;
  const models = types.flatMap((type) => (
    MODEL_MAKE_MATRIX[type]?.[configuredMake]?.map((entry) => entry.name) ?? []
  ));
  return models.length ? uniqueInWorkbookOrder(models) : null;
}

export function getWorkbookMakeName(assetType: string | null, rawMake: string): string {
  return resolveConfiguredMake(catalogTypes(assetType), rawMake) ?? rawMake.trim();
}

export function getWorkbookModelName(
  assetType: string | null,
  rawMake: string,
  rawModel: string | null,
): string | null {
  const trimmedModel = rawModel?.trim();
  if (!trimmedModel) return null;

  const types = catalogTypes(assetType);
  const configuredMake = resolveConfiguredMake(types, rawMake);
  if (!configuredMake) return trimmedModel;

  const rawKey = modelKey(trimmedModel, configuredMake);
  const entries = types.flatMap((type) => MODEL_MAKE_MATRIX[type]?.[configuredMake] ?? []);
  const match = entries.find((entry) => (
    [entry.name, ...(entry.aliases ?? [])]
      .some((candidate) => modelKey(candidate, configuredMake) === rawKey)
  ));

  return match?.name ?? trimmedModel;
}
