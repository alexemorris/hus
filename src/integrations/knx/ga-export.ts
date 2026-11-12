import type { KnxProject } from './project.ts';

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: readonly (readonly (string | number)[])[]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** ETS-style group address list (Address, Name, DPT, Main, Middle, Description). */
export function exportGroupAddressCsv(project: Pick<KnxProject, 'groupAddresses'>): string {
  return csv([
    ['Address', 'Name', 'DPT', 'Main group', 'Middle group', 'Description'],
    ...project.groupAddresses.map((g) => [g.address, g.name, g.dpt, g.main, g.middle, g.description]),
  ]);
}

/** Device list (individual address, name, role, building/floor/zone, description). */
export function exportDeviceCsv(project: Pick<KnxProject, 'physicalDevices'>): string {
  const sorted = [...project.physicalDevices].sort((a, b) => comparePa(a.pa, b.pa));
  return csv([
    ['Individual address', 'Name', 'Role', 'Building', 'Floor', 'Zone', 'Description'],
    ...sorted.map((d) => [d.pa, d.name, d.role, d.buildingId, d.floorId, d.zoneId, d.description]),
  ]);
}

function comparePa(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
