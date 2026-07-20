import { volvoRfmsAdapter } from "./volvoRfmsAdapter";

export const activeFleetAdapter = volvoRfmsAdapter;

export type ActiveFleetAdapter = typeof activeFleetAdapter;
