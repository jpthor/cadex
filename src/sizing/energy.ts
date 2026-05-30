export function reservePctToFraction(reservePct: number) {
  if (!Number.isFinite(reservePct)) return 0;
  return Math.min(0.95, Math.max(0, reservePct / 100));
}

export function usableBatteryFraction(reservePct: number) {
  return Math.max(0.05, 1 - reservePctToFraction(reservePct));
}

export function installedEnergyForMissionWh(missionEnergyWh: number, reservePct: number) {
  return Math.max(missionEnergyWh, 0) / usableBatteryFraction(reservePct);
}

export function usableEnergyFromInstalledWh(installedEnergyWh: number, reservePct: number) {
  return Math.max(installedEnergyWh, 0) * usableBatteryFraction(reservePct);
}

export function reserveEnergyForMissionWh(missionEnergyWh: number, reservePct: number) {
  return Math.max(0, installedEnergyForMissionWh(missionEnergyWh, reservePct) - Math.max(missionEnergyWh, 0));
}
