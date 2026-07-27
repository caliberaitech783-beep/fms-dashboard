type ModelMakeMatrix = Record<string, Record<string, readonly string[]>>;

// Source: "Model & Make.xlsx", sheet "Lists (2)".
const MODEL_MAKE_MATRIX: ModelMakeMatrix = {
  Dozer: {
    Dozco: ["DH24C3"],
    Komatsu: ["D85"],
    Liebherr: ["PR736"],
    LiuGong: ["B160", "B230", "CLGB160", "LD20D", "LGCB160"],
  },
  Drill: {
    LiuGong: ["CLG921", "CLG922E"],
  },
  Dumper: {
    LiuGong: ["DW105A"],
    Sany: ["SKT105"],
  },
  Excavator: {
    JCB: ["215LC", "JCB215"],
    LiuGong: ["965E", "975HD", "CLG922", "CLG926", "LGI921", "LGI922E", "G935"],
    Sany: ["SANY580", "SY380", "SY215C"],
    "Tata Hitachi": ["ZX650", "ZX470", "ZX490", "ZX670", "ZX870", "ZX890"],
    Volvo: ["EC480", "EC550"],
  },
  Grader: {
    Case: ["CASE865C"],
    CAT: ["CAT140GC"],
    LiuGong: ["CLG4180D", "CLG4215D", "CLG4230D", "CLG423OD"],
  },
  Hydra: {
    Escort: ["ESCORTTRX17", "F23 CE-V", "HYDRA15"],
  },
  Loader: {
    Hindustan: ["2021D"],
    LiuGong: ["CLG856H", "CLG856H MAX", "CLG856H (5 MT)", "CLG856H HST"],
    SDLG: ["SDLGL958H"],
  },
  "Surface Miner": {
    "L&T": ["KSM403"],
  },
  Tipper: {
    Eicher: ["PRO8035XM"],
    Scania: ["G440", "G500"],
    Tata: ["PRIMALX"],
    Volvo: ["FMX460", "FMX500"],
  },
};

const PORTAL_TYPE_TO_MASTER_TYPE: Record<string, string> = {
  "Haul Pack": "Dumper",
  Loader: "Loader",
  Tipper: "Tipper",
};

const TRUCK_MAKES = ["Eicher", "Scania", "Volvo"] as const;

export function getConfiguredMakes(assetType: string): string[] | null {
  if (assetType === "Truck") {
    return [...TRUCK_MAKES];
  }

  const masterType = PORTAL_TYPE_TO_MASTER_TYPE[assetType] ?? assetType;
  const makes = MODEL_MAKE_MATRIX[masterType];
  return makes ? Object.keys(makes) : null;
}
