import { mockAdapter } from "./mockAdapter";
import { DUMMY_DATA_END_DATE } from "../../data/mock/seed";

export const activeFleetAdapter = mockAdapter;

export const activeDataSource = {
  mode: "demo" as const,
  label: "Demo data",
  asOf: DUMMY_DATA_END_DATE,
};

export type ActiveFleetAdapter = typeof activeFleetAdapter;
