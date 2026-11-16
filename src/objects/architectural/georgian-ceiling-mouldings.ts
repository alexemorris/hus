import * as THREE from 'three';
import { createSkirtingRun, type SkirtingProfilePoint } from '../cad/skirting-run.ts';
import { sharedCylinderGeometry, sharedTorusGeometry } from '../shared/geometry-cache.ts';
import { prepGeo, tagHighLod } from '../shared/scene-helpers.ts';

let cachedLimePlasterMouldingMat: THREE.MeshStandardMaterial | null = null;

export function getGeorgianPlasterMouldingMaterial(): THREE.MeshStandardMaterial {
  if (!cachedLimePlasterMouldingMat) {
    cachedLimePlasterMouldingMat = new THREE.MeshStandardMaterial({
      name: 'georgianLimePlasterMoulding',
      color: 0xf5f2ea,
      roughness: 0.72,
      metalness: 0.0,
    });
  }
  return cachedLimePlasterMouldingMat;
}

export interface GeorgianCeilingPanelMouldingOptions {
  readonly name?: string;
  /** World/local position of panel center on ceiling soffit (`[cx, ceilingY, cz]`). */
  readonly position?: readonly [number, number, number];
  /** Outer width of inset panel along X in metres. */
  readonly widthM: number;
  /** Outer depth of inset panel along Z in metres. */
  readonly depthM: number;
  /** Astragal rail width in metres (default `0.038`). */
  readonly mouldingWidthM?: number;
  /** Downward relief depth in metres (default `0.016`). */
  readonly reliefDepthM?: number;
  readonly includeCornerRosettes?: boolean;
  readonly material?: THREE.Material;
  readonly zone?: string;
}

/**
 * Inset Georgian plaster astragal ceiling panel moulding (`y = 0` at ceiling soffit, projecting `-Y`
 * with `0.8 mm` soffit clearance so zero z-fighting occurs), suitable for parenting to `ceilingGroup`
 * around a central `buildGeorgianCeilingRose`.
 */
export function buildGeorgianCeilingPanelMoulding(
  opts: GeorgianCeilingPanelMouldingOptions
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianCeilingPanelMoulding';
  const mat = opts.material ?? getGeorgianPlasterMouldingMaterial();
  const w = Math.max(0.6, opts.widthM);
  const d = Math.max(0.6, opts.depthM);
  const rw = opts.mouldingWidthM ?? 0.038;
  const rd = opts.reliefDepthM ?? 0.016;

  // Rectangular closed loop at y = -rd - 0.0008, swept upward to -0.0008
  const halfW = w * 0.5;
  const halfD = d * 0.5;
  const profile: readonly SkirtingProfilePoint[] = [
    { u: 0.0005, v: 0.0004, sharp: true },
    { u: rw * 0.22, v: 0.0004, sharp: true },
    { u: rw * 0.5, v: rd * 0.35 },
    { u: rw * 0.78, v: 0.0004, sharp: true },
    { u: rw, v: rd * 0.45, sharp: true },
    { u: rw, v: rd, sharp: true },
    { u: 0.0005, v: rd, sharp: true },
  ];

  const root = new THREE.Group();
  root.name = namePrefix;
  if (opts.zone) {
    root.userData.zone = opts.zone;
  }

  // CCW in (X, -Z) -> (-halfW, -halfD) -> (-halfW, +halfD) -> (+halfW, +halfD) -> (+halfW, -halfD)
  // Check normal for (-halfW, -halfD) -> (-halfW, +halfD): tangent = [0, 0, +1].
  // With roomSide = 'left', normal = [hz, 0, -hx] = [+1, 0, 0] (inward +X!).
  const panelRails = createSkirtingRun({
    name: `${namePrefix}.astragalFrame`,
    path: [
      [-halfW, -halfD],
      [-halfW, halfD],
      [halfW, halfD],
      [halfW, -halfD],
    ],
    closed: true,
    roomSide: 'left',
    elevationY: -(rd + 0.0008),
    profile,
    material: mat,
    zone: opts.zone,
  });
  root.add(panelRails);

  if (opts.includeCornerRosettes ?? true) {
    const inset = rw + 0.075;
    for (const [tag, sx, sz] of [
      ['NW', -1, -1],
      ['SW', -1, 1],
      ['SE', 1, 1],
      ['NE', 1, -1],
    ] as const) {
      const cx = sx * (halfW - inset);
      const cz = sz * (halfD - inset);
      const ring = new THREE.Mesh(
        prepGeo(sharedTorusGeometry(0.036, 0.0055, 8, 20)),
        mat
      );
      ring.name = `${namePrefix}.cornerRing_${tag}`;
      ring.rotation.x = Math.PI * 0.5;
      ring.position.set(cx, -0.007, cz);
      tagHighLod(ring);
      root.add(ring);

      const boss = new THREE.Mesh(
        prepGeo(sharedCylinderGeometry(0.014, 0.018, 0.011, 14)),
        mat
      );
      boss.name = `${namePrefix}.cornerBoss_${tag}`;
      boss.position.set(cx, -0.0065, cz);
      tagHighLod(boss);
      root.add(boss);
    }
  }

  if (opts.position) {
    root.position.set(opts.position[0], opts.position[1], opts.position[2]);
  }
  return root;
}

export { buildGeorgianCeilingRose, type GeorgianCeilingRoseOptions } from './georgian-facade-and-fireplace.ts';
