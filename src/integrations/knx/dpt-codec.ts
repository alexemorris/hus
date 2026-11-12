import { encodeGroupAddress, encodePhysicalAddress, formatFrameHex } from './addressing.ts';

/**
 * Bidirectional KNX Datapoint Type (DPT) Codec & TP1/cEMI Frame Parser.
 * Enables the Digital Twin to both transmit standard KNX frames and ingest
 * real-time frames from a physical KNX bus (via KNXnet/IP / WebSocket gateway).
 */

export interface ParsedKNXFrame {
  readonly src: string;
  readonly dst: string;
  readonly isGroup: boolean;
  readonly apci: string;
  readonly payloadBytes: readonly number[];
  readonly hex: string;
  readonly validChecksum: boolean;
}

export function decodePhysicalAddress(hi: number, lo: number): string {
  const word = ((hi & 0xff) << 8) | (lo & 0xff);
  const area = (word >> 12) & 0x0f;
  const line = (word >> 8) & 0x0f;
  const dev = word & 0xff;
  return `${area}.${line}.${dev}`;
}

export function decodeGroupAddress(hi: number, lo: number): string {
  const word = ((hi & 0xff) << 8) | (lo & 0xff);
  const main = (word >> 11) & 0x1f;
  const mid = (word >> 8) & 0x07;
  const sub = word & 0xff;
  return `${main}/${mid}/${sub}`;
}

/**
 * DPT 1.001 (Switch) / DPT 1.018 (Occupancy): 1-bit boolean packed in APCI second byte.
 */
export function encodeDpt1(value: boolean): readonly [number, number] {
  return [0x00, value ? 0x81 : 0x80];
}

export function decodeDpt1(payloadBytes: readonly number[]): boolean {
  if (payloadBytes.length === 0) return false;
  const lastByte = payloadBytes[payloadBytes.length - 1] ?? 0;
  return (lastByte & 0x01) === 1;
}

/**
 * DPT 5.001 (Scaling 0..100% <-> 0..255).
 */
export function encodeDpt5Scaling(pct: number): readonly [number, number, number] {
  const clamped = Math.max(0, Math.min(100, pct));
  return [0x00, 0x80, Math.round((clamped / 100) * 255) & 0xff];
}

export function decodeDpt5Scaling(payloadBytes: readonly number[]): number {
  if (payloadBytes.length === 0) return 0;
  const raw = payloadBytes[payloadBytes.length - 1] ?? 0;
  return Math.round(((raw & 0xff) / 255) * 100);
}

/**
 * DPT 9.004 (Illuminance Lux 2-byte KNX Float: V = (0.01 * M) * 2^E).
 */
export function encodeDpt9Float(value: number): readonly [number, number, number, number] {
  let v = Math.round(value * 100);
  let e = 0;
  while (v < -2048 || v > 2047) {
    v = Math.round(v / 2);
    e++;
    if (e >= 15) break;
  }
  const sign = v < 0 ? 1 : 0;
  const mantissa = v < 0 ? (v + 2048) & 0x07ff : v & 0x07ff;
  const word = (sign << 15) | ((e & 0x0f) << 11) | mantissa;
  return [0x00, 0x80, (word >> 8) & 0xff, word & 0xff];
}

export function decodeDpt9Float(payloadBytes: readonly number[]): number {
  if (payloadBytes.length < 2) return 0;
  const hi = payloadBytes[payloadBytes.length - 2] ?? 0;
  const lo = payloadBytes[payloadBytes.length - 1] ?? 0;
  const word = ((hi & 0xff) << 8) | (lo & 0xff);
  const sign = (word & 0x8000) !== 0;
  const exp = (word >> 11) & 0x0f;
  let mant = word & 0x07ff;
  if (sign) {
    mant = mant - 2048;
  }
  return Math.round(0.01 * mant * Math.pow(2, exp));
}

/**
 * DPT 17.001 (Scene Number 0..63).
 */
export function encodeDpt17Scene(sceneIndex: number): readonly [number, number, number] {
  return [0x00, 0x80, sceneIndex & 0x3f];
}

export function decodeDpt17Scene(payloadBytes: readonly number[]): number {
  if (payloadBytes.length === 0) return 0;
  return (payloadBytes[payloadBytes.length - 1] ?? 0) & 0x3f;
}

/**
 * DPT 18.001 (Scene Control: bit 7 = store/learn, bits 0..5 = scene index).
 */
export function encodeDpt18SceneControl(
  sceneIndex: number,
  store: boolean
): readonly [number, number, number] {
  return [0x00, 0x80, (store ? 0x80 : 0x00) | (sceneIndex & 0x3f)];
}

export function decodeDpt18SceneControl(payloadBytes: readonly number[]): {
  readonly store: boolean;
  readonly sceneIndex: number;
} {
  if (payloadBytes.length === 0) {
    return { store: false, sceneIndex: 0 };
  }
  const b = payloadBytes[payloadBytes.length - 1] ?? 0;
  return {
    store: (b & 0x80) !== 0,
    sceneIndex: b & 0x3f,
  };
}

/**
 * Builds a raw KNX TP1 frame hex string with XOR checksum.
 */
export function buildTP1FrameHex(
  src: string,
  dst: string,
  isGroup: boolean,
  payloadBytes: readonly number[]
): string {
  const [srcHi, srcLo] = encodePhysicalAddress(src);
  const [dstHi, dstLo] = isGroup ? encodeGroupAddress(dst) : encodePhysicalAddress(dst);
  const len = payloadBytes.length;
  const npci = (isGroup ? 0xe0 : 0x60) | (len & 0x0f);
  const rawBytes = [0xbc, srcHi, srcLo, dstHi, dstLo, npci, ...payloadBytes];
  return formatFrameHex(rawBytes);
}

/**
 * Parses a raw KNX TP1 hex string (e.g. "BC 11 0A 0A 01 E3 00 80 FF 5E")
 * into its structured addresses, APCI, and payload bytes.
 */
export function parseTP1FrameHex(hexStr: string): ParsedKNXFrame | null {
  const tokens = hexStr
    .trim()
    .split(/[\s,:]+/)
    .filter((t) => t.length > 0);
  if (tokens.length < 8) return null;

  const bytes = tokens.map((t) => Number.parseInt(t, 16));
  if (bytes.some((b) => Number.isNaN(b))) return null;

  const srcHi = bytes[1] ?? 0;
  const srcLo = bytes[2] ?? 0;
  const dstHi = bytes[3] ?? 0;
  const dstLo = bytes[4] ?? 0;
  const npci = bytes[5] ?? 0xe0;

  const isGroup = (npci & 0x80) !== 0;
  const src = decodePhysicalAddress(srcHi, srcLo);
  const dst = isGroup ? decodeGroupAddress(dstHi, dstLo) : decodePhysicalAddress(dstHi, dstLo);

  // Verify XOR checksum (last byte)
  const payloadEnd = bytes.length - 1;
  let xor = 0xff;
  for (let i = 0; i < payloadEnd; i++) {
    xor ^= bytes[i] ?? 0;
  }
  const expectedChecksum = xor & 0xff;
  const actualChecksum = bytes[payloadEnd] ?? 0;
  const validChecksum = expectedChecksum === actualChecksum;

  const payloadBytes = bytes.slice(6, payloadEnd);
  let apci = 'A_GroupValue_Write';
  if (payloadBytes.length >= 2) {
    const apciWord = (((payloadBytes[0] ?? 0) & 0x03) << 8) | (payloadBytes[1] ?? 0);
    const apciType = apciWord & 0x03c0;
    if (apciType === 0x0000) apci = 'A_GroupValue_Read';
    else if (apciType === 0x0040) apci = 'A_GroupValue_Response';
    else if (apciType === 0x0080) apci = 'A_GroupValue_Write';
  }

  return {
    src,
    dst,
    isGroup,
    apci,
    payloadBytes,
    hex: tokens.map((t) => t.toUpperCase().padStart(2, '0')).join(' '),
    validChecksum,
  };
}
