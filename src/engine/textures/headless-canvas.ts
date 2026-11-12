/**
 * Lightweight pure-TypeScript RGBA8 2D software canvas fallback for headless Node / Vitest
 * environments where `document` is absent (`typeof document === 'undefined'`).
 *
 * Supports transforms (`save`, `restore`, `translate`, `rotate`, `scale`), paths (`beginPath`,
 * `moveTo`, `lineTo`, `quadraticCurveTo`, `bezierCurveTo`, `arc`, `ellipse`, `rect`, `roundRect`,
 * `closePath`), scanline polygon `fill()`, thick-segment `stroke()`, `clip()`, linear & radial
 * gradients, `fillRect`/`clearRect`/`strokeRect`, `getImageData`/`putImageData`/`createImageData`,
 * and `drawImage` so procedural PBR masonry/cobblestone generators produce real RGBA pixels,
 * Sobel normal maps, and roughness maps without a browser DOM.
 */

interface RgbaStop {
  readonly offset: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

class SoftwareLinearGradient {
  private readonly stops: RgbaStop[] = [];
  public constructor(
    private readonly x0: number,
    private readonly y0: number,
    private readonly x1: number,
    private readonly y1: number
  ) {}

  public addColorStop(offset: number, color: string): void {
    const [r, g, b, a] = parseCssColor(color);
    this.stops.push({ offset: Math.max(0, Math.min(1, offset)), r, g, b, a });
    this.stops.sort((u, v) => u.offset - v.offset);
  }

  public sample(px: number, py: number): readonly [number, number, number, number] {
    const dx = this.x1 - this.x0;
    const dy = this.y1 - this.y0;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 1e-6 ? Math.max(0, Math.min(1, ((px - this.x0) * dx + (py - this.y0) * dy) / lenSq)) : 0;
    return sampleGradientStops(this.stops, t);
  }
}

class SoftwareRadialGradient {
  private readonly stops: RgbaStop[] = [];
  public constructor(
    private readonly x0: number,
    private readonly y0: number,
    private readonly r0: number,
    private readonly x1: number,
    private readonly y1: number,
    private readonly r1: number
  ) {}

  public addColorStop(offset: number, color: string): void {
    const [r, g, b, a] = parseCssColor(color);
    this.stops.push({ offset: Math.max(0, Math.min(1, offset)), r, g, b, a });
    this.stops.sort((u, v) => u.offset - v.offset);
  }

  public sample(px: number, py: number): readonly [number, number, number, number] {
    const cx = (this.x0 + this.x1) * 0.5;
    const cy = (this.y0 + this.y1) * 0.5;
    const dist = Math.hypot(px - cx, py - cy);
    const span = Math.max(1e-5, this.r1 - this.r0);
    const t = Math.max(0, Math.min(1, (dist - this.r0) / span));
    return sampleGradientStops(this.stops, t);
  }
}

function sampleGradientStops(
  stops: readonly RgbaStop[],
  t: number
): readonly [number, number, number, number] {
  if (stops.length === 0) return [0, 0, 0, 255];
  if (stops.length === 1 || t <= stops[0]!.offset) {
    const s = stops[0]!;
    return [s.r, s.g, s.b, s.a];
  }
  const last = stops[stops.length - 1]!;
  if (t >= last.offset) {
    return [last.r, last.g, last.b, last.a];
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i]!;
    const s1 = stops[i + 1]!;
    if (t >= s0.offset && t <= s1.offset) {
      const f = (t - s0.offset) / Math.max(1e-6, s1.offset - s0.offset);
      return [
        Math.round(s0.r + (s1.r - s0.r) * f),
        Math.round(s0.g + (s1.g - s0.g) * f),
        Math.round(s0.b + (s1.b - s0.b) * f),
        Math.round(s0.a + (s1.a - s0.a) * f),
      ];
    }
  }
  return [last.r, last.g, last.b, last.a];
}

export function parseCssColor(raw: unknown): readonly [number, number, number, number] {
  if (typeof raw !== 'string') return [0, 0, 0, 255];
  const s = raw.trim();
  if (s.startsWith('#')) {
    if (s.length === 4) {
      const r = parseInt(s[1]! + s[1]!, 16);
      const g = parseInt(s[2]! + s[2]!, 16);
      const b = parseInt(s[3]! + s[3]!, 16);
      return [r || 0, g || 0, b || 0, 255];
    }
    if (s.length === 7 || s.length === 9) {
      const r = parseInt(s.slice(1, 3), 16);
      const g = parseInt(s.slice(3, 5), 16);
      const b = parseInt(s.slice(5, 7), 16);
      const a = s.length === 9 ? parseInt(s.slice(7, 9), 16) : 255;
      return [r || 0, g || 0, b || 0, Number.isNaN(a) ? 255 : a];
    }
  }
  const m = /^rgba?\(\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)(?:\s*,\s*([+-]?[\d.]+))?\s*\)$/i.exec(s);
  if (m) {
    const r = Math.max(0, Math.min(255, Math.round(Number(m[1]))));
    const g = Math.max(0, Math.min(255, Math.round(Number(m[2]))));
    const b = Math.max(0, Math.min(255, Math.round(Number(m[3]))));
    const a = m[4] !== undefined ? Math.max(0, Math.min(255, Math.round(Number(m[4]) * 255))) : 255;
    return [r, g, b, a];
  }
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s === 'white') return [255, 255, 255, 255];
  if (s === 'black') return [0, 0, 0, 255];
  return [128, 128, 128, 255];
}

interface Subpath {
  pts: Array<readonly [number, number]>;
  closed: boolean;
}

type PaintStyle = string | SoftwareLinearGradient | SoftwareRadialGradient;

interface ContextState {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  fillStyle: PaintStyle;
  strokeStyle: PaintStyle;
  lineWidth: number;
  globalAlpha: number;
  clipMinX: number;
  clipMinY: number;
  clipMaxX: number;
  clipMaxY: number;
}

class HeadlessCanvas2DContext {
  public fillStyle: PaintStyle = '#000000';
  public strokeStyle: PaintStyle = '#000000';
  public lineWidth = 1;
  public globalAlpha = 1;
  public lineCap = 'butt';
  public lineJoin = 'miter';
  public font = '10px sans-serif';
  public textAlign = 'start';
  public textBaseline = 'alphabetic';

  private a = 1;
  private b = 0;
  private c = 0;
  private d = 1;
  private e = 0;
  private f = 0;
  private clipMinX = 0;
  private clipMinY = 0;
  private clipMaxX = 1e9;
  private clipMaxY = 1e9;
  private readonly stack: ContextState[] = [];
  private subpaths: Subpath[] = [];
  private currentSubpath: Subpath | null = null;

  public constructor(public readonly canvas: HeadlessSoftwareCanvas) {}

  public resetClipToCanvas(): void {
    this.clipMinX = 0;
    this.clipMinY = 0;
    this.clipMaxX = this.canvas.width;
    this.clipMaxY = this.canvas.height;
  }

  private tx(x: number, y: number): readonly [number, number] {
    return [this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f];
  }

  public save(): void {
    this.stack.push({
      a: this.a,
      b: this.b,
      c: this.c,
      d: this.d,
      e: this.e,
      f: this.f,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha,
      clipMinX: this.clipMinX,
      clipMinY: this.clipMinY,
      clipMaxX: this.clipMaxX,
      clipMaxY: this.clipMaxY,
    });
  }

  public restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.a = s.a;
    this.b = s.b;
    this.c = s.c;
    this.d = s.d;
    this.e = s.e;
    this.f = s.f;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.globalAlpha = s.globalAlpha;
    this.clipMinX = s.clipMinX;
    this.clipMinY = s.clipMinY;
    this.clipMaxX = s.clipMaxX;
    this.clipMaxY = s.clipMaxY;
  }

  public translate(dx: number, dy: number): void {
    this.e += this.a * dx + this.c * dy;
    this.f += this.b * dx + this.d * dy;
  }

  public scale(sx: number, sy: number): void {
    this.a *= sx;
    this.b *= sx;
    this.c *= sy;
    this.d *= sy;
  }

  public rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const na = this.a * cos + this.c * sin;
    const nb = this.b * cos + this.d * sin;
    const nc = -this.a * sin + this.c * cos;
    const nd = -this.b * sin + this.d * cos;
    this.a = na;
    this.b = nb;
    this.c = nc;
    this.d = nd;
  }

  public setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
  }

  public resetTransform(): void {
    this.setTransform(1, 0, 0, 1, 0, 0);
  }

  public getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    return { a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f };
  }

  public createLinearGradient(x0: number, y0: number, x1: number, y1: number): SoftwareLinearGradient {
    const [p0x, p0y] = this.tx(x0, y0);
    const [p1x, p1y] = this.tx(x1, y1);
    return new SoftwareLinearGradient(p0x, p0y, p1x, p1y);
  }

  public createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): SoftwareRadialGradient {
    const [p0x, p0y] = this.tx(x0, y0);
    const [p1x, p1y] = this.tx(x1, y1);
    const scale = Math.hypot(this.a, this.b);
    return new SoftwareRadialGradient(p0x, p0y, r0 * scale, p1x, p1y, r1 * scale);
  }

  public createPattern(): Record<string, never> {
    return {};
  }

  private blendPixel(px: number, py: number, r: number, g: number, b: number, aByte: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const effA = Math.round(aByte * Math.max(0, Math.min(1, this.globalAlpha)));
    if (effA <= 0) return;
    const data = this.canvas.pixels;
    const idx = (py * w + px) * 4;
    if (effA >= 255) {
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    } else {
      const inv = 255 - effA;
      data[idx] = (r * effA + data[idx]! * inv + 127) >> 8;
      data[idx + 1] = (g * effA + data[idx + 1]! * inv + 127) >> 8;
      data[idx + 2] = (b * effA + data[idx + 2]! * inv + 127) >> 8;
      data[idx + 3] = Math.min(255, effA + ((data[idx + 3]! * inv + 127) >> 8));
    }
  }

  private evalStyle(style: PaintStyle, px: number, py: number): readonly [number, number, number, number] {
    if (style instanceof SoftwareLinearGradient || style instanceof SoftwareRadialGradient) {
      return style.sample(px + 0.5, py + 0.5);
    }
    return parseCssColor(style);
  }

  public clearRect(x: number, y: number, w: number, h: number): void {
    const [x0, y0] = this.tx(x, y);
    const [x1, y1] = this.tx(x + w, y + h);
    const minX = Math.max(0, Math.floor(Math.min(x0, x1)));
    const maxX = Math.min(this.canvas.width, Math.ceil(Math.max(x0, x1)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1)));
    const maxY = Math.min(this.canvas.height, Math.ceil(Math.max(y0, y1)));
    const cw = this.canvas.width;
    const data = this.canvas.pixels;
    for (let py = minY; py < maxY; py++) {
      let idx = (py * cw + minX) * 4;
      for (let px = minX; px < maxX; px++) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
        idx += 4;
      }
    }
  }

  public fillRect(x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    if (Math.abs(this.b) < 1e-6 && Math.abs(this.c) < 1e-6) {
      const fx0 = this.a * x + this.e;
      const fy0 = this.d * y + this.f;
      const fx1 = this.a * (x + w) + this.e;
      const fy1 = this.d * (y + h) + this.f;
      const minX = Math.max(0, Math.max(Math.floor(this.clipMinX), Math.floor(Math.min(fx0, fx1))));
      const maxX = Math.min(this.canvas.width, Math.min(Math.ceil(this.clipMaxX), Math.ceil(Math.max(fx0, fx1))));
      const minY = Math.max(0, Math.max(Math.floor(this.clipMinY), Math.floor(Math.min(fy0, fy1))));
      const maxY = Math.min(this.canvas.height, Math.min(Math.ceil(this.clipMaxY), Math.ceil(Math.max(fy0, fy1))));
      if (minX >= maxX || minY >= maxY) return;

      const style = this.fillStyle;
      if (typeof style === 'string') {
        const [r, g, b, a] = parseCssColor(style);
        const effA = Math.round(a * Math.max(0, Math.min(1, this.globalAlpha)));
        if (effA <= 0) return;
        const cw = this.canvas.width;
        const data = this.canvas.pixels;
        if (effA >= 255) {
          for (let py = minY; py < maxY; py++) {
            let idx = (py * cw + minX) * 4;
            for (let px = minX; px < maxX; px++) {
              data[idx] = r;
              data[idx + 1] = g;
              data[idx + 2] = b;
              data[idx + 3] = 255;
              idx += 4;
            }
          }
        } else {
          for (let py = minY; py < maxY; py++) {
            for (let px = minX; px < maxX; px++) {
              this.blendPixel(px, py, r, g, b, a);
            }
          }
        }
      } else {
        for (let py = minY; py < maxY; py++) {
          for (let px = minX; px < maxX; px++) {
            const [r, g, b, a] = style.sample(px + 0.5, py + 0.5);
            this.blendPixel(px, py, r, g, b, a);
          }
        }
      }
      return;
    }

    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
  }

  public strokeRect(x: number, y: number, w: number, h: number): void {
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
  }

  public beginPath(): void {
    this.subpaths = [];
    this.currentSubpath = null;
  }

  public moveTo(x: number, y: number): void {
    const p = this.tx(x, y);
    const sp: Subpath = { pts: [p], closed: false };
    this.subpaths.push(sp);
    this.currentSubpath = sp;
  }

  public lineTo(x: number, y: number): void {
    const p = this.tx(x, y);
    if (!this.currentSubpath) {
      const sp: Subpath = { pts: [p], closed: false };
      this.subpaths.push(sp);
      this.currentSubpath = sp;
    } else {
      this.currentSubpath.pts.push(p);
    }
  }

  public closePath(): void {
    if (this.currentSubpath && this.currentSubpath.pts.length > 0) {
      this.currentSubpath.closed = true;
    }
  }

  public quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!this.currentSubpath || this.currentSubpath.pts.length === 0) {
      this.moveTo(cpx, cpy);
    }
    const pts = this.currentSubpath!.pts;
    const [x0, y0] = pts[pts.length - 1]!;
    const [cx, cy] = this.tx(cpx, cpy);
    const [x1, y1] = this.tx(x, y);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      pts.push([mt * mt * x0 + 2 * mt * t * cx + t * t * x1, mt * mt * y0 + 2 * mt * t * cy + t * t * y1]);
    }
  }

  public bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number
  ): void {
    if (!this.currentSubpath || this.currentSubpath.pts.length === 0) {
      this.moveTo(cp1x, cp1y);
    }
    const pts = this.currentSubpath!.pts;
    const [x0, y0] = pts[pts.length - 1]!;
    const [c1x, c1y] = this.tx(cp1x, cp1y);
    const [c2x, c2y] = this.tx(cp2x, cp2y);
    const [x1, y1] = this.tx(x, y);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      pts.push([
        mt * mt * mt * x0 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x1,
        mt * mt * mt * y0 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y1,
      ]);
    }
  }

  public arc(
    cx: number,
    cy: number,
    r: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false
  ): void {
    this.ellipse(cx, cy, r, r, 0, startAngle, endAngle, counterclockwise);
  }

  public ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false
  ): void {
    let delta = endAngle - startAngle;
    if (!counterclockwise && delta < 0) delta += Math.PI * 2;
    else if (counterclockwise && delta > 0) delta -= Math.PI * 2;
    const steps = Math.max(8, Math.min(24, Math.ceil((Math.abs(delta) / (Math.PI * 2)) * 18)));
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    for (let i = 0; i <= steps; i++) {
      const ang = startAngle + (delta * i) / steps;
      const lx = Math.cos(ang) * rx;
      const ly = Math.sin(ang) * ry;
      const px = cx + lx * cosR - ly * sinR;
      const py = cy + lx * sinR + ly * cosR;
      if (i === 0 && (!this.currentSubpath || this.currentSubpath.pts.length === 0)) {
        this.moveTo(px, py);
      } else {
        this.lineTo(px, py);
      }
    }
  }

  public rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }

  public roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii?: number | readonly number[]
  ): void {
    const rawR = Array.isArray(radii) ? Number(radii[0] ?? 0) : typeof radii === 'number' ? radii : 0;
    const r = Math.max(0, Math.min(rawR, Math.abs(w) * 0.5, Math.abs(h) * 0.5));
    if (r <= 0.25) {
      this.rect(x, y, w, h);
      return;
    }
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
  }

  public clip(): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const sp of this.subpaths) {
      for (const [px, py] of sp.pts) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
    if (minX <= maxX && minY <= maxY) {
      this.clipMinX = Math.max(this.clipMinX, minX);
      this.clipMinY = Math.max(this.clipMinY, minY);
      this.clipMaxX = Math.min(this.clipMaxX, maxX);
      this.clipMaxY = Math.min(this.clipMaxY, maxY);
    }
  }

  public fill(): void {
    if (this.subpaths.length === 0) return;
    const edges: Array<readonly [number, number, number, number]> = [];
    let minY = Infinity;
    let maxY = -Infinity;

    for (const sp of this.subpaths) {
      const pts = sp.pts;
      if (pts.length < 3) continue;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i]!;
        const [x1, y1] = pts[(i + 1) % pts.length]!;
        if (Math.abs(y1 - y0) < 1e-6) continue;
        edges.push([x0, y0, x1, y1]);
        if (y0 < minY) minY = y0;
        if (y1 < minY) minY = y1;
        if (y0 > maxY) maxY = y0;
        if (y1 > maxY) maxY = y1;
      }
    }
    if (edges.length === 0) return;

    const yStart = Math.max(0, Math.max(Math.floor(this.clipMinY), Math.floor(minY)));
    const yEnd = Math.min(this.canvas.height, Math.min(Math.ceil(this.clipMaxY), Math.ceil(maxY)));
    const xClipMin = Math.max(0, Math.floor(this.clipMinX));
    const xClipMax = Math.min(this.canvas.width, Math.ceil(this.clipMaxX));
    if (yStart >= yEnd || xClipMin >= xClipMax) return;

    const style = this.fillStyle;
    const solid = typeof style === 'string' ? parseCssColor(style) : null;
    const xs: number[] = [];

    for (let py = yStart; py < yEnd; py++) {
      const scanY = py + 0.5;
      xs.length = 0;
      for (let e = 0; e < edges.length; e++) {
        const [x0, y0, x1, y1] = edges[e]!;
        if ((y0 <= scanY && y1 > scanY) || (y1 <= scanY && y0 > scanY)) {
          const t = (scanY - y0) / (y1 - y0);
          xs.push(x0 + t * (x1 - x0));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const spanStart = Math.max(xClipMin, Math.floor(xs[k]! + 0.5));
        const spanEnd = Math.min(xClipMax, Math.floor(xs[k + 1]! + 0.5));
        for (let px = spanStart; px < spanEnd; px++) {
          const [r, g, b, a] = solid ?? this.evalStyle(style, px, py);
          this.blendPixel(px, py, r, g, b, a);
        }
      }
    }
  }

  public stroke(): void {
    if (this.subpaths.length === 0) return;
    const halfW = Math.max(0.5, this.lineWidth * Math.hypot(this.a, this.b) * 0.5);
    const style = this.strokeStyle;
    const solid = typeof style === 'string' ? parseCssColor(style) : null;
    const xClipMin = Math.max(0, Math.floor(this.clipMinX));
    const xClipMax = Math.min(this.canvas.width, Math.ceil(this.clipMaxX));
    const yClipMin = Math.max(0, Math.floor(this.clipMinY));
    const yClipMax = Math.min(this.canvas.height, Math.ceil(this.clipMaxY));

    const drawSegment = (x0: number, y0: number, x1: number, y1: number): void => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(len * 1.5));
      const rInt = Math.max(0, Math.floor(halfW));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = Math.round(x0 + dx * t);
        const cy = Math.round(y0 + dy * t);
        for (let oy = -rInt; oy <= rInt; oy++) {
          const py = cy + oy;
          if (py < yClipMin || py >= yClipMax) continue;
          for (let ox = -rInt; ox <= rInt; ox++) {
            const px = cx + ox;
            if (px < xClipMin || px >= xClipMax) continue;
            const [r, g, b, a] = solid ?? this.evalStyle(style, px, py);
            this.blendPixel(px, py, r, g, b, a);
          }
        }
      }
    };

    for (const sp of this.subpaths) {
      const pts = sp.pts;
      if (pts.length < 2) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        drawSegment(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]);
      }
      if (sp.closed && pts.length > 2) {
        const last = pts[pts.length - 1]!;
        const first = pts[0]!;
        drawSegment(last[0], last[1], first[0], first[1]);
      }
    }
  }

  public createImageData(w: number, h: number): ImageData {
    const iw = Math.max(1, Math.floor(w));
    const ih = Math.max(1, Math.floor(h));
    return {
      width: iw,
      height: ih,
      colorSpace: 'srgb',
      data: new Uint8ClampedArray(iw * ih * 4),
    } as ImageData;
  }

  public getImageData(sx: number, sy: number, sw: number, sh: number): ImageData {
    const iw = Math.max(1, Math.floor(sw));
    const ih = Math.max(1, Math.floor(sh));
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    if (ix === 0 && iy === 0 && iw === this.canvas.width && ih === this.canvas.height) {
      return {
        width: iw,
        height: ih,
        colorSpace: 'srgb',
        data: new Uint8ClampedArray(this.canvas.pixels),
      } as ImageData;
    }
    const out = new Uint8ClampedArray(iw * ih * 4);
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const src = this.canvas.pixels;
    for (let y = 0; y < ih; y++) {
      const py = iy + y;
      if (py < 0 || py >= ch) continue;
      for (let x = 0; x < iw; x++) {
        const px = ix + x;
        if (px < 0 || px >= cw) continue;
        const sIdx = (py * cw + px) * 4;
        const dIdx = (y * iw + x) * 4;
        out[dIdx] = src[sIdx]!;
        out[dIdx + 1] = src[sIdx + 1]!;
        out[dIdx + 2] = src[sIdx + 2]!;
        out[dIdx + 3] = src[sIdx + 3]!;
      }
    }
    return { width: iw, height: ih, colorSpace: 'srgb', data: out } as ImageData;
  }

  public putImageData(imgData: ImageData, dx: number, dy: number): void {
    const ix = Math.floor(dx);
    const iy = Math.floor(dy);
    const iw = imgData.width;
    const ih = imgData.height;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (ix === 0 && iy === 0 && iw === cw && ih === ch) {
      this.canvas.pixels.set(imgData.data);
      return;
    }
    const dst = this.canvas.pixels;
    const src = imgData.data;
    for (let y = 0; y < ih; y++) {
      const py = iy + y;
      if (py < 0 || py >= ch) continue;
      for (let x = 0; x < iw; x++) {
        const px = ix + x;
        if (px < 0 || px >= cw) continue;
        const sIdx = (y * iw + x) * 4;
        const dIdx = (py * cw + px) * 4;
        dst[dIdx] = src[sIdx]!;
        dst[dIdx + 1] = src[sIdx + 1]!;
        dst[dIdx + 2] = src[sIdx + 2]!;
        dst[dIdx + 3] = src[sIdx + 3]!;
      }
    }
  }

  public drawImage(
    source: { width?: number; height?: number; getContext?: (type: string) => unknown },
    dx: number,
    dy: number,
    dw?: number,
    dh?: number
  ): void {
    const srcW = Math.max(1, Number(source?.width ?? 0));
    const srcH = Math.max(1, Number(source?.height ?? 0));
    if (!source || typeof source.getContext !== 'function') return;
    const srcCtx = source.getContext('2d') as { getImageData?: (x: number, y: number, w: number, h: number) => ImageData } | null;
    if (!srcCtx || typeof srcCtx.getImageData !== 'function') return;
    const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;
    const targetW = Math.max(1, Math.floor(dw ?? srcW));
    const targetH = Math.max(1, Math.floor(dh ?? srcH));
    const ox = Math.floor(dx);
    const oy = Math.floor(dy);
    const scaleX = srcW / targetW;
    const scaleY = srcH / targetH;
    for (let y = 0; y < targetH; y++) {
      const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * scaleY));
      for (let x = 0; x < targetW; x++) {
        const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * scaleX));
        const sIdx = (sy * srcW + sx) * 4;
        this.blendPixel(ox + x, oy + y, srcData[sIdx]!, srcData[sIdx + 1]!, srcData[sIdx + 2]!, srcData[sIdx + 3]!);
      }
    }
  }

  public setLineDash(): void {}
  public fillText(): void {}
  public strokeText(): void {}
  public measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }
  public isPointInPath(): boolean {
    return false;
  }
}

class HeadlessSoftwareCanvas {
  private _w: number;
  private _h: number;
  public pixels: Uint8ClampedArray;
  private ctx2d: HeadlessCanvas2DContext | null = null;
  public readonly style: Record<string, string> = {};

  public constructor(width = 300, height = 150) {
    this._w = Math.max(0, Math.floor(width));
    this._h = Math.max(0, Math.floor(height));
    this.pixels = new Uint8ClampedArray(this._w * this._h * 4);
  }

  public get width(): number {
    return this._w;
  }

  public set width(v: number) {
    this._w = Math.max(0, Math.floor(v));
    this.pixels = new Uint8ClampedArray(this._w * this._h * 4);
    this.ctx2d?.resetClipToCanvas();
  }

  public get height(): number {
    return this._h;
  }

  public set height(v: number) {
    this._h = Math.max(0, Math.floor(v));
    this.pixels = new Uint8ClampedArray(this._w * this._h * 4);
    this.ctx2d?.resetClipToCanvas();
  }

  public getContext(kind: string): HeadlessCanvas2DContext | null {
    if (kind !== '2d') return null;
    if (!this.ctx2d) {
      this.ctx2d = new HeadlessCanvas2DContext(this);
      this.ctx2d.resetClipToCanvas();
    }
    return this.ctx2d;
  }

  public toDataURL(): string {
    return '';
  }

  public addEventListener(): void {}
  public removeEventListener(): void {}
}

/**
 * Creates a DOM `HTMLCanvasElement` when `document.createElement` is available,
 * or a pure-TypeScript RGBA8 software canvas in headless Node / Vitest runtimes.
 */
export function createRuntimeOrHeadlessCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return new HeadlessSoftwareCanvas(width, height) as unknown as HTMLCanvasElement;
}
