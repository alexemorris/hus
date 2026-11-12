import type { DeviceParameters, ScenePreset } from '../../core/types/knx.ts';
import { SCENE_CIRCUIT_IDS } from './scene-table.ts';

export function encodePhysicalAddress(paStr: string): readonly [number, number] {
  const parts = paStr.split('.').map(Number);
  const area = parts[0] ?? 1;
  const line = parts[1] ?? 1;
  const dev = parts[2] ?? 1;
  const word = ((area & 0x0f) << 12) | ((line & 0x0f) << 8) | (dev & 0xff);
  return [(word >> 8) & 0xff, word & 0xff];
}

export function encodeGroupAddress(gaStr: string): readonly [number, number] {
  const parts = gaStr.split('/').map(Number);
  const main = parts[0] ?? 1;
  const mid = parts[1] ?? 0;
  const sub = parts[2] ?? 0;
  const word = ((main & 0x1f) << 11) | ((mid & 0x07) << 8) | (sub & 0xff);
  return [(word >> 8) & 0xff, word & 0xff];
}

function toHexByte(n: number): string {
  return (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

export function formatFrameHex(bytes: readonly number[]): string {
  let xor = 0xff;
  for (const b of bytes) {
    xor ^= b;
  }
  const full = [...bytes, xor & 0xff];
  return full.map(toHexByte).join(' ');
}

/**
 * Compiles the 64-byte EEPROM Memory Image (0x4000..0x403F) for Switch 1.1.10 and Actuator 1.1.20.
 */
export function compileEEPROMBytes(
  params: Readonly<DeviceParameters>,
  scenes: readonly ScenePreset[]
): Uint8Array {
  const bytes = new Uint8Array(64);

  // 0x4000: Address Table (Count = 8: PA 1.1.20 + 7 GAs)
  bytes[0] = 0x08;
  const [paHi, paLo] = encodePhysicalAddress('1.1.20');
  bytes[1] = paHi;
  bytes[2] = paLo;

  const gas = ['1/0/0', '1/0/1', '1/2/1', '1/2/2', '1/2/3', '1/2/4', '1/2/5'];
  let offset = 3;
  for (const ga of gas) {
    const [gHi, gLo] = encodeGroupAddress(ga);
    bytes[offset++] = gHi;
    bytes[offset++] = gLo;
  }

  // 0x4011..0x4017: Association Table pairs
  for (let i = 0; i < 7; i++) {
    bytes[17 + i] = ((i + 1) << 4) | (i & 0x0f);
  }

  // 0x4018..0x401F: Switch 1.1.10, Sensor 1.1.12/13 & Actuator 1.1.20 Parameter Segment
  const holdCode = Math.round(params.holdThresholdMs / 50);
  const modeCode = params.shortPressMode === 'cycle3' ? 0x03 : 0x13;
  const wakeCode = params.wakeBehavior === 'last' ? 0x02 : 0x01;
  const rampCode = Math.round(params.rampSpeedSec * 10);
  const luxCode = Math.max(1, Math.min(255, Math.round(params.luxThreshold / 2)));

  bytes[24] = holdCode & 0xff;
  bytes[25] = modeCode;
  bytes[26] = wakeCode;
  bytes[27] = rampCode & 0xff;
  bytes[28] = 0x07; // Mask 0x07B0 Hi
  bytes[29] = 0xb0; // Mask 0x07B0 Lo
  bytes[30] = 0x01; // LoadState = LOADED (0x01)
  bytes[31] = luxCode & 0xff; // Night-Walk Lux Threshold (lux / 2)

  // 0x4020..0x402E: 3 Scenes x 5 Kitchen Channels (15 bytes)
  let sceneOffset = 32;
  for (let s = 0; s < 3; s++) {
    const scene = scenes[s];
    for (const cId of SCENE_CIRCUIT_IDS) {
      const pct = scene ? (scene.levels[cId] ?? 0) : 0;
      bytes[sceneOffset++] = Math.round((pct / 100) * 255);
    }
  }

  // 0x4034..0x403F: Trailer + CRC16 checksum
  let crc = 0x1d0f;
  for (let i = 0; i < 62; i++) {
    crc = ((crc << 5) ^ (bytes[i] ?? 0)) & 0xffff;
  }
  bytes[62] = (crc >> 8) & 0xff;
  bytes[63] = crc & 0xff;

  return bytes;
}
