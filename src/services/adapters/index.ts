import { volvoRfmsAdapter } from "./volvoRfmsAdapter";

export const activeFleetAdapter = volvoRfmsAdapter;

export const activeDataSource = {
  mode: "demo" as const,
  label: "Demo data",
  asOf: DUMMY_DATA_END_DATE,
};

export type ActiveFleetAdapter = typeof activeFleetAdapter;
