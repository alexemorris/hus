import type { RoomFinishSpec, RoomPaintSurfaceSpec } from '../types/twin-ux.ts';
/**
 * Self-contained 3D Smart Asset metadata, Bill-of-Materials schedule, and
 * in-viewer Asset Inspector types & pure formatters.
 *
 * Pure core module with zero `three` or DOM dependencies.
 */

export interface AssetLink {
  readonly label: string;
  readonly url: string;
  readonly kind?: 'product' | 'schematic' | 'manual' | 'supplier';
}

export type AssetCategory =
  | 'sanitaryware'
  | 'brassware'
  | 'appliance'
  | 'furniture'
  | 'lighting'
  | 'joinery'
  | 'hardware'
  | 'antiques'
  | 'architectural'
  | 'decor'
  | 'device'
  | 'vehicle';

export interface AssetPrice {
  readonly amount: number;
  readonly currency: 'GBP' | 'USD' | 'EUR';
  readonly incVat?: boolean;
}

export interface AssetMetadata {
  readonly id?: string;
  /** Human-readable product title, e.g. "Perrin & Rowe Phoenician 4471 Bridge Mixer". */
  readonly name: string;
  /** Manufacturer / brand name, e.g. "Perrin & Rowe". */
  readonly brand?: string;
  /** Range / collection name, e.g. "Classical" or "Chichester". */
  readonly collection?: string;
  /** Manufacturer SKU / part code (reflecting parameterized finish, e.g. "4471AB"). */
  readonly sku?: string;
  /** Human-readable finish label, e.g. "Aged Brass (AB)". */
  readonly finish?: string;
  readonly category?: AssetCategory;
  /** Nominal bounding dimensions `[widthMm, depthMm, heightMm]`. */
  readonly dimensionsMm?: readonly [width: number, depth: number, height: number];
  /** Manufacturer / showroom product web page URL. */
  readonly productUrl?: string;
  /** Technical CAD / dimensional spec sheet / installation schematic URL. */
  readonly schematicUrl?: string;
  /** Optional extra links (manuals, suppliers, CAD downloads). */
  readonly links?: readonly AssetLink[];
  readonly price?: AssetPrice;
  readonly notes?: string;
}

export interface InspectedAssetAction {
  readonly id: string;
  readonly label: string;
  readonly active?: boolean;
  readonly kind: 'hinge' | 'slide' | 'toggle' | 'custom' | 'sound';
}

export interface InspectedAssetSnapshot {
  readonly assetUuid: string;
  readonly metadata: AssetMetadata;
  readonly roomZoneId?: string | null;
  readonly roomLabel?: string;
  readonly worldCenter: readonly [number, number, number];
  readonly worldBoundsMin: readonly [number, number, number];
  readonly worldBoundsMax: readonly [number, number, number];
  readonly actions: readonly InspectedAssetAction[];
  readonly hasSpatialAudio: boolean;
}

export interface TwinAssetInspectorApi {
  isInspectMode(): boolean;
  setInspectMode(active: boolean): boolean;
  toggleInspectMode(): boolean;
  getInspected(): InspectedAssetSnapshot | null;
  onChanged(listener: (snapshot: InspectedAssetSnapshot | null) => void): () => void;
  inspectAtClient(clientX: number, clientY: number): InspectedAssetSnapshot | null;
  clear(): void;
  frameInspected(): void;
  triggerAction(actionId: string): boolean;
  playSound(): boolean;
}

export interface AssetScheduleEntry {
  readonly key: string;
  readonly name: string;
  readonly brand?: string;
  readonly collection?: string;
  readonly sku?: string;
  readonly finish?: string;
  readonly category?: AssetCategory;
  readonly dimensionsMm?: readonly [width: number, depth: number, height: number];
  readonly productUrl?: string;
  readonly schematicUrl?: string;
  readonly links?: readonly AssetLink[];
  readonly unitPrice?: AssetPrice;
  readonly quantity: number;
  readonly zones: readonly string[];
  readonly primaryZone?: string;
}

export interface AssetScheduleOptions {
  readonly houseId?: string;
  readonly houseName?: string;
  /** When true, splits schedule rows per room/zone instead of consolidating across the house. */
  readonly groupByZone?: boolean;
  /** Optional room label resolver for zone IDs. */
  readonly getZoneLabel?: (zoneId: string) => string;
}

export interface RoomFinishScheduleEntry {
  readonly zoneId: string;
  readonly label: string;
  readonly group?: string;
  readonly floor?: string;
  readonly finishes?: RoomFinishSpec;
  readonly notes?: readonly string[];
}

export interface AssetScheduleReport {
  readonly houseId?: string;
  readonly houseName?: string;
  readonly groupByZone: boolean;
  readonly totalPlacedAssets: number;
  readonly uniqueEntries: number;
  readonly entries: readonly AssetScheduleEntry[];
  readonly roomFinishes?: readonly RoomFinishScheduleEntry[];
}

export function formatAssetDimensionsMm(
  dims: readonly [number, number, number] | undefined
): string {
  if (!dims) return '';
  const [w, d, h] = dims;
  return `${Math.round(w)} × ${Math.round(d)} × ${Math.round(h)} mm`;
}

const CURRENCY_SYMBOLS: Readonly<Record<AssetPrice['currency'], string>> = {
  GBP: '£',
  USD: '$',
  EUR: '€',
};

export function formatAssetPrice(price: AssetPrice | undefined): string {
  if (!price || !Number.isFinite(price.amount)) return '';
  const sym = CURRENCY_SYMBOLS[price.currency] ?? `${price.currency} `;
  const formatted = price.amount.toLocaleString('en-GB', {
    minimumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const vatSuffix =
    price.incVat === true ? ' inc. VAT' : price.incVat === false ? ' ex. VAT' : '';
  return `${sym}${formatted}${vatSuffix}`;
}

/** Normalizes all product, schematic, and extra links for an `AssetMetadata` record without duplicates. */
export function resolveAssetLinks(meta: AssetMetadata): readonly AssetLink[] {
  const seenUrls = new Set<string>();
  const out: AssetLink[] = [];
  const push = (link: AssetLink): void => {
    const trimmed = link.url.trim();
    if (!trimmed || seenUrls.has(trimmed)) return;
    seenUrls.add(trimmed);
    out.push({ ...link, url: trimmed });
  };
  if (meta.productUrl) {
    push({ label: 'Product Page', url: meta.productUrl, kind: 'product' });
  }
  if (meta.schematicUrl) {
    push({ label: 'Technical Schematic / CAD', url: meta.schematicUrl, kind: 'schematic' });
  }
  if (meta.links) {
    for (const link of meta.links) {
      push(link);
    }
  }
  return out;
}

export function formatPaintSurfaceSummary(
  spec: RoomPaintSurfaceSpec | readonly RoomPaintSurfaceSpec[] | undefined
): string {
  if (!spec) return '';
  const items: readonly RoomPaintSurfaceSpec[] = Array.isArray(spec) ? spec : [spec as RoomPaintSurfaceSpec];
  return items
    .map((s) => {
      const head = [s.brand, s.name, s.code ? `(${s.code})` : undefined].filter(Boolean).join(' ');
      const tail = [s.hex, s.sheen].filter(Boolean).join(' · ');
      return tail ? `${head} [${tail}]` : head;
    })
    .join(' + ');
}

function padCell(text: string, width: number, alignRight = false): string {
  if (text.length >= width) return text.slice(0, width);
  return alignRight ? text.padStart(width, ' ') : text.padEnd(width, ' ');
}

export function formatAssetScheduleTable(report: AssetScheduleReport): string {
  const title = report.houseName || report.houseId || 'Hus.js Scene';
  const header = `[husjs schedule] ${title}: ${report.totalPlacedAssets} smart asset(s) across ${report.uniqueEntries} schedule line(s)`;
  if (report.entries.length === 0 && (!report.roomFinishes || report.roomFinishes.length === 0)) {
    return `${header}\n(no smart assets with attached AssetMetadata found)`;
  }

  const rows = report.entries.map((e) => ({
    qty: String(e.quantity),
    sku: e.sku ?? '—',
    brand: e.brand ?? '—',
    name: e.name,
    finish: e.finish ?? '—',
    dims: formatAssetDimensionsMm(e.dimensionsMm) || '—',
    zone: (report.groupByZone ? e.primaryZone : e.zones.join(', ')) || 'unassigned',
    schematic: e.schematicUrl ? 'yes' : '—',
  }));

  const widths = {
    qty: Math.max(3, ...rows.map((r) => r.qty.length)),
    sku: Math.min(20, Math.max(3, ...rows.map((r) => r.sku.length))),
    brand: Math.min(18, Math.max(5, ...rows.map((r) => r.brand.length))),
    name: Math.min(38, Math.max(5, ...rows.map((r) => r.name.length))),
    finish: Math.min(22, Math.max(6, ...rows.map((r) => r.finish.length))),
    dims: Math.min(22, Math.max(10, ...rows.map((r) => r.dims.length))),
    zone: Math.min(26, Math.max(4, ...rows.map((r) => r.zone.length))),
    schematic: 3,
  };

  const lines: string[] = [
    header,
    [
      padCell('Qty', widths.qty, true),
      padCell('SKU', widths.sku),
      padCell('Brand', widths.brand),
      padCell('Asset', widths.name),
      padCell('Finish', widths.finish),
      padCell('Dimensions', widths.dims),
      padCell('Zone', widths.zone),
      padCell('CAD', widths.schematic),
    ].join(' | '),
    [
      '-'.repeat(widths.qty),
      '-'.repeat(widths.sku),
      '-'.repeat(widths.brand),
      '-'.repeat(widths.name),
      '-'.repeat(widths.finish),
      '-'.repeat(widths.dims),
      '-'.repeat(widths.zone),
      '-'.repeat(widths.schematic),
    ].join('-+-'),
  ];

  for (const r of rows) {
    lines.push(
      [
        padCell(r.qty, widths.qty, true),
        padCell(r.sku, widths.sku),
        padCell(r.brand, widths.brand),
        padCell(r.name, widths.name),
        padCell(r.finish, widths.finish),
        padCell(r.dims, widths.dims),
        padCell(r.zone, widths.zone),
        padCell(r.schematic, widths.schematic),
      ].join(' | ')
    );
  }

  if (report.roomFinishes && report.roomFinishes.length > 0) {
    lines.push('');
    lines.push(`Room Finishes & Paint Schedule (${report.roomFinishes.length} room(s))`);
    const finishRows = report.roomFinishes.map((rf) => ({
      room: rf.label || rf.zoneId,
      walls: formatPaintSurfaceSummary(rf.finishes?.walls) || '—',
      ceiling: formatPaintSurfaceSummary(rf.finishes?.ceiling) || '—',
      trim: formatPaintSurfaceSummary(rf.finishes?.trim) || '—',
      flooring: rf.finishes?.flooring ?? '—',
    }));
    const fWidths = {
      room: Math.min(28, Math.max(4, ...finishRows.map((r) => r.room.length))),
      walls: Math.min(36, Math.max(5, ...finishRows.map((r) => r.walls.length))),
      ceiling: Math.min(30, Math.max(7, ...finishRows.map((r) => r.ceiling.length))),
      trim: Math.min(30, Math.max(4, ...finishRows.map((r) => r.trim.length))),
      flooring: Math.min(34, Math.max(8, ...finishRows.map((r) => r.flooring.length))),
    };
    lines.push(
      [
        padCell('Room', fWidths.room),
        padCell('Walls', fWidths.walls),
        padCell('Ceiling', fWidths.ceiling),
        padCell('Trim', fWidths.trim),
        padCell('Flooring', fWidths.flooring),
      ].join(' | ')
    );
    lines.push(
      [
        '-'.repeat(fWidths.room),
        '-'.repeat(fWidths.walls),
        '-'.repeat(fWidths.ceiling),
        '-'.repeat(fWidths.trim),
        '-'.repeat(fWidths.flooring),
      ].join('-+-')
    );
    for (const fr of finishRows) {
      lines.push(
        [
          padCell(fr.room, fWidths.room),
          padCell(fr.walls, fWidths.walls),
          padCell(fr.ceiling, fWidths.ceiling),
          padCell(fr.trim, fWidths.trim),
          padCell(fr.flooring, fWidths.flooring),
        ].join(' | ')
      );
    }
  }

  return lines.join('\n');
}

function escapeMd(text: string | undefined): string {
  if (!text) return '—';
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function formatAssetScheduleMarkdown(report: AssetScheduleReport): string {
  const title = report.houseName || report.houseId || 'Hus.js Scene';
  const lines: string[] = [
    `# Bill of Materials & Schematic Schedule — ${title}`,
    '',
    `Total placed smart assets: **${report.totalPlacedAssets}** (${report.uniqueEntries} unique schedule entries)`,
    '',
    '| Qty | SKU | Brand | Asset | Finish | Dimensions (W × D × H) | Zone(s) | Links |',
    '| ---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  ];

  for (const e of report.entries) {
    const linkParts: string[] = [];
    if (e.productUrl) linkParts.push(`[Product](${e.productUrl})`);
    if (e.schematicUrl) linkParts.push(`[Schematic](${e.schematicUrl})`);
    const zones = report.groupByZone ? (e.primaryZone ?? 'unassigned') : e.zones.join(', ') || 'unassigned';
    lines.push(
      `| ${e.quantity} | ${escapeMd(e.sku)} | ${escapeMd(e.brand)} | ${escapeMd(e.name)} | ${escapeMd(e.finish)} | ${escapeMd(formatAssetDimensionsMm(e.dimensionsMm) || undefined)} | ${escapeMd(zones)} | ${linkParts.join(' · ') || '—'} |`
    );
  }

  if (report.roomFinishes && report.roomFinishes.length > 0) {
    lines.push(
      '',
      '## Room Finishes & Paint Schedule',
      '',
      `Embedded room finish records: **${report.roomFinishes.length}**`,
      '',
      '| Room | Floor | Walls | Ceiling | Trim | Flooring | Tiling / Wallpaper | Joinery | Notes |',
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |'
    );
    for (const rf of report.roomFinishes) {
      const f = rf.finishes;
      const mergedNotes = Array.from(
        new Set([...(f?.notes ?? []), ...(rf.notes ?? [])].map((n) => n.trim()).filter(Boolean))
      );
      lines.push(
        `| ${escapeMd(rf.label || rf.zoneId)} | ${escapeMd(rf.floor)} | ${escapeMd(formatPaintSurfaceSummary(f?.walls) || undefined)} | ${escapeMd(formatPaintSurfaceSummary(f?.ceiling) || undefined)} | ${escapeMd(formatPaintSurfaceSummary(f?.trim) || undefined)} | ${escapeMd(f?.flooring)} | ${escapeMd(f?.tilingOrWallpaper)} | ${escapeMd(f?.joinery)} | ${escapeMd(mergedNotes.join('; ') || undefined)} |`
      );
    }
  }

  return lines.join('\n');
}

function csvCell(value: string | number | undefined): string {
  const s = value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatAssetScheduleCsv(report: AssetScheduleReport): string {
  const headers = [
    'quantity',
    'sku',
    'brand',
    'collection',
    'name',
    'finish',
    'category',
    'width_mm',
    'depth_mm',
    'height_mm',
    'zones',
    'product_url',
    'schematic_url',
  ];
  const lines: string[] = [headers.join(',')];
  for (const e of report.entries) {
    const dims = e.dimensionsMm;
    const zones = report.groupByZone ? (e.primaryZone ?? '') : e.zones.join('; ');
    lines.push(
      [
        csvCell(e.quantity),
        csvCell(e.sku),
        csvCell(e.brand),
        csvCell(e.collection),
        csvCell(e.name),
        csvCell(e.finish),
        csvCell(e.category),
        csvCell(dims?.[0]),
        csvCell(dims?.[1]),
        csvCell(dims?.[2]),
        csvCell(zones),
        csvCell(e.productUrl),
        csvCell(e.schematicUrl),
      ].join(',')
    );
  }
  return lines.join('\n');
}
