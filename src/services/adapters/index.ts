import { mockAdapter } from "./mockAdapter";

export const activeFleetAdapter = mockAdapter;

export type ActiveFleetAdapter = typeof activeFleetAdapter;
