import type { Vehicle, Company } from '../types/fleet';
import { equipmentMasterService, type EquipmentRecord } from './equipmentMasterService';
import { DASHBOARD_SITES } from '../constants/sites';
const key = (value: string) => {
  const serial = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^(YV2|YS2)[A-HJ-NPR-Z0-9]{14}[A-Z][0-9]{2}$/.test(serial) ? serial.slice(0, 17) : serial;
};
export function masterCompany(row: EquipmentRecord, fallback?: Company): Company | undefined {
  const label = `${row.oem} ${row.model}`.toLowerCase();
  const names: Company[] = ['Volvo', 'Scania', 'LiuGong', 'Eicher', 'Case', 'Tata Hitachi', 'Komatsu'];
  const explicit = names.find(name => label.includes(name.toLowerCase()));
  if (explicit) return explicit;
  if (row.serialNumber.startsWith('YV2')) return 'Volvo';
  if (row.serialNumber.startsWith('YS2')) return 'Scania';
  if (/^(LGI|CLG)/.test(row.serialNumber)) return 'LiuGong';
  return fallback;
}
function siteFor(location: string) {
  const name = key(location);
  const exact = DASHBOARD_SITES.find(site => key(site.name) === name);
  if (exact) return exact;
  const aliases: [RegExp, string][] = [[/SASTI/,'site-wcl-sasti-ocm'],[/DHOPTALA/,'site-wcl-dhoptala-ocm'],[/LALPETH/,'site-wcl-lalpeth-ocm'],[/MAJRI/,'site-wcl-majri-ocm'],[/GAURI|GOURI/,'site-wcl-gauri-pauni'],[/DCH.*EAST|DUDHICHUA.*EAST/,'site-ncl-dch-east'],[/DCH.*WEST|DUDHICHUA/,'site-ncl-dch-west'],[/JAYANT/,'site-ncl-jayant-1']];
  return DASHBOARD_SITES.find(site => site.id === aliases.find(([pattern]) => pattern.test(name))?.[1]);
}
export function equipmentFleet(vehicles: Vehicle[], rows: EquipmentRecord[], selectedCompany = 'All'): Vehicle[] {
  const byVin = new Map(vehicles.map(vehicle => [key(vehicle.trackerId), vehicle]));
  return rows.flatMap(row => {
    const source = byVin.get(key(row.serialNumber));
    if (!source) return [];
    const company = masterCompany(row, source.company);
    if (!company || (selectedCompany !== 'All' && company.toLowerCase() !== selectedCompany.toLowerCase())) return [];
    const site = siteFor(row.location);
    const category = /truck|tipper|haul/i.test(row.category) ? 'Truck' : row.category ? 'HEMM' : source?.assetCategory || (company === 'Volvo' || company === 'Scania' ? 'Truck' : 'Unknown');
    const sources: Partial<Record<Company, Vehicle['source']>> = {Volvo:'VOLVO_RFMS_LIVE',Scania:'SCANIA_RFMS_LIVE',LiuGong:'LIUGONG_NBI_LIVE',Eicher:'EICHER_VECV_LIVE',Case:'CASE_EQUIPMENT_LIVE'};
    return [{ id: source?.id || `equipment-${row.id}`, source: sources[company],
      vehicleNumber: row.equipment, doorNumber: row.equipment, trackerId: source.trackerId,
      company, assetCategory: category, assetType: source?.assetType || null,
      modelNumber: row.model || source?.modelNumber || null, siteId: site?.id || null, siteName: row.location || null,
      contractType: site?.contractType || null, fuelMeasurementUnit: category === 'Truck' ? 'km/L' : 'L/hr',
      trackerProvider: source?.trackerProvider || company, status: source?.status || 'unknown', active: true,
      capacityM3: source?.capacityM3 || null, commissioningDate: source?.commissioningDate || null,
      fuelTankCapacityLitres: source?.fuelTankCapacityLitres || null, standardFuelNorm: source?.standardFuelNorm || null } as Vehicle];
  });
}
export async function applyEquipmentMaster(vehicles: Vehicle[], company = 'All') {
  return equipmentFleet(vehicles, await equipmentMasterService.fleet(), company);
}
