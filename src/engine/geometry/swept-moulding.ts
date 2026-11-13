import * as THREE from 'three';

/**
 * Sweeps a 2D moulding cross-section along a polyline drawn in a wall's vertical plane, with true mitred
 * joints at every kink (the classic "stringer capping" / "dado rail up a staircase" case).
 *
 * Coordinates:
 * - `profile` is drawn in (d, h): `d` is the projection out from the wall face (>= 0) and `h` is the offset
 *   perpendicular to the path, measured upward from the path line.
 * - `path` is a list of (a, y) points in the wall plane, where `a` runs along the wall and `y` is height.
 *   Points must be ordered by strictly increasing `a`.
 * - `toSpace(a, y, d)` maps a wall-plane point plus outward projection into the target 3D space.
 */
export function buildSweptMouldingGeometry(
  profile: THREE.Shape,
  path: ReadonlyArray<readonly [number, number]>,
  toSpace: (a: number, y: number, d: number) => THREE.Vector3,
  curveSegments = 6
): THREE.BufferGeometry {
  const segs: Array<{ p0: THREE.Vector2; t: THREE.Vector2; n: THREE.Vector2; len: number }> = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [a0, y0] = path[i];
    const [a1, y1] = path[i + 1];
    const d = new THREE.Vector2(a1 - a0, y1 - y0);
    const len = d.length();
    const t = d.clone().divideScalar(len);
    segs.push({ p0: new THREE.Vector2(a0, y0), t, n: new THREE.Vector2(-t.y, t.x), len });
  }

  // Unit-depth extrusion of the profile: local (x, y, z) = (d, h, s) with s in [0, 1].
  const unit = new THREE.ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false, curveSegments });
  const unitFlat = unit.index ? unit.toNonIndexed() : unit;
  const src = unitFlat.getAttribute('position');
  const srcUv = unitFlat.getAttribute('uv');

  const positions: number[] = [];
  const uvs: number[] = [];
  const tmp = new THREE.Vector3();

  segs.forEach((seg, i) => {
    const prev = i > 0 ? segs[i - 1] : undefined;
    const next = i + 1 < segs.length ? segs[i + 1] : undefined;
    // Mitre shift along the path as a function of h (see derivation: plane normal = t_prev + t_next).
    const startK = prev ? -seg.n.dot(prev.t) / (1 + seg.t.dot(prev.t)) : 0;
    const endK = next ? -seg.n.dot(next.t) / (1 + seg.t.dot(next.t)) : 0;

    // Handedness of the (out, n, t) basis in the target space decides whether winding must flip.
    const o3 = toSpace(seg.p0.x, seg.p0.y, 1).sub(toSpace(seg.p0.x, seg.p0.y, 0));
    const n3 = toSpace(seg.p0.x + seg.n.x, seg.p0.y + seg.n.y, 0).sub(toSpace(seg.p0.x, seg.p0.y, 0));
    const t3 = toSpace(seg.p0.x + seg.t.x, seg.p0.y + seg.t.y, 0).sub(toSpace(seg.p0.x, seg.p0.y, 0));
    const flip = o3.dot(n3.clone().cross(t3)) < 0;

    for (let v = 0; v < src.count; v += 3) {
      const s0 = src.getZ(v);
      const s1 = src.getZ(v + 1);
      const s2 = src.getZ(v + 2);
      // Omit internal cap faces at intermediate mitred corners so only outer ends are capped.
      if (prev && s0 < 0.5 && s1 < 0.5 && s2 < 0.5) continue;
      if (next && s0 > 0.5 && s1 > 0.5 && s2 > 0.5) continue;
      const order = flip ? [v, v + 2, v + 1] : [v, v + 1, v + 2];
      for (const idx of order) {
        const d = src.getX(idx);
        const h = src.getY(idx);
        const s = src.getZ(idx);
        const along = s < 0.5 ? h * startK : seg.len + h * endK;
        const a = seg.p0.x + seg.t.x * along + seg.n.x * h;
        const y = seg.p0.y + seg.t.y * along + seg.n.y * h;
        tmp.copy(toSpace(a, y, d));
        positions.push(tmp.x, tmp.y, tmp.z);
        if (srcUv) {
          uvs.push(srcUv.getX(idx), srcUv.getY(idx) * (s < 0.5 ? 1 : seg.len));
        }
      }
    }
  });

  unit.dispose();
  if (unitFlat !== unit) unitFlat.dispose();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uvs.length > 0) {
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Antique oak skirting-style capping profile (`d` = out from wall, `h` = up from the `0.122m` board top line):
 * steps inward from the `0.022m`-thick base board into a `0.0175m` torus roll, concave ogee/cove neck
 * (`0.011m`), and `0.008m` top fillet at `h = +0.024m` (total skirting/stringer height `0.146m`), matching
 * the Hall and Dining Room skirting boards.
 */
export function createSkirtingCapProfile(): THREE.Shape {
  const s = new THREE.Shape();
  // Starts at y = -0.027m (i.e. 0.095m above floor when path is at 0.122m) so the lower quirk,
  // cyma reversa ogee cove, and upper torus roll form a prominent 51mm-tall architectural moulding band!
  s.moveTo(0, -0.027);
  s.lineTo(0.022, -0.027);
  // Crisp 4.5mm recessed quirk step at 95mm height
  s.lineTo(0.0175, -0.025);
  s.lineTo(0.0175, -0.021);
  // Swept concave/convex cyma reversa ogee throat (-0.021m .. -0.004m)
  s.quadraticCurveTo(0.0195, -0.015, 0.0155, -0.009);
  s.quadraticCurveTo(0.0115, -0.005, 0.0135, -0.002);
  // Crisp fillet step into the projecting upper torus roll (-0.002m .. +0.014m)
  s.lineTo(0.0165, -0.001);
  s.quadraticCurveTo(0.0205, 0.006, 0.0165, 0.013);
  // Upper cavetto neck & top chamfered wall-return fillet (+0.013m .. +0.024m)
  s.quadraticCurveTo(0.011, 0.017, 0.0095, 0.021);
  s.lineTo(0.006, 0.024);
  s.lineTo(0, 0.024);
  s.closePath();
  return s;
}

/**
 * Drop-in 3D extruded Ogee/Torus skirting moulding cap geometry centered on its bounding box
 * (`span` along X when `isAlongX = true` or along Z when `isAlongX = false`, centered around
 * `y = floorY + 0.122 + 0.012`), with the sculpted moulding face oriented toward `inwardSign`.
 */
export function createProfiledSkirtingCapGeometry(
  span: number,
  isAlongX: boolean,
  inwardSign: 1 | -1
): THREE.BufferGeometry {
  // 24mm-tall (`y = 0..0.024m`) full Quirk + Ogee + Torus cap profile that sits ON TOP of a `0.122m`
  // lower plinth board (centered at `y = +0.012m` -> local `-0.012m..+0.012m`) so none of the Ogee cove
  // is buried inside the lower plinth box!
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.020, 0);
  // Crisp lower quirk step at top of plinth
  s.lineTo(0.016, 0.0015);
  s.lineTo(0.016, 0.004);
  // Swept concave/convex cyma reversa ogee throat (0.004m .. 0.013m)
  s.quadraticCurveTo(0.018, 0.007, 0.014, 0.010);
  s.quadraticCurveTo(0.010, 0.012, 0.012, 0.014);
  // Projecting upper torus bead roll (0.014m .. 0.020m)
  s.lineTo(0.015, 0.0145);
  s.quadraticCurveTo(0.0185, 0.0175, 0.0145, 0.0205);
  // Upper cavetto & chamfered wall-return fillet (0.0205m .. 0.024m)
  s.quadraticCurveTo(0.0095, 0.0225, 0.006, 0.024);
  s.lineTo(0, 0.024);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: span,
    bevelEnabled: false,
    curveSegments: 8,
  });
  // Center extrusion along Z (`-span/2 .. +span/2`), center Y around `0.012m`, and center X around `0.008m`
  geo.translate(-0.008, -0.012, -span * 0.5);
  if (isAlongX) {
    geo.rotateY(inwardSign > 0 ? -Math.PI / 2 : Math.PI / 2);
  } else if (inwardSign < 0) {
    geo.rotateY(Math.PI);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Full-height 146mm antique oak ogee/torus skirting board cross-section in `(y, h)`:
 * - `y` (first coordinate `d` in `buildSweptMouldingGeometry`) is vertical height above the floor (`0..0.146m`),
 * - `h` (second coordinate `h` in `buildSweptMouldingGeometry`) is horizontal projection out from the wall (`0..0.022m`).
 */
export function createWallSkirtingBoardProfile(): THREE.Shape {
  const s = new THREE.Shape();
  const backGap = 0.004;
  s.moveTo(0.004, backGap);
  s.lineTo(0.004, backGap + 0.020);
  // Flat lower plinth face (4mm .. 95mm)
  s.lineTo(0.095, backGap + 0.020);
  // Crisp 4.5mm quirk step at 95mm height
  s.lineTo(0.097, backGap + 0.0155);
  s.lineTo(0.101, backGap + 0.0155);
  // Swept cyma reversa ogee curve (101mm .. 120mm)
  s.quadraticCurveTo(0.107, backGap + 0.0175, 0.113, backGap + 0.0135);
  s.quadraticCurveTo(0.117, backGap + 0.0095, 0.120, backGap + 0.0115);
  // Projecting upper torus roll (120mm .. 135mm)
  s.lineTo(0.121, backGap + 0.0145);
  s.quadraticCurveTo(0.128, backGap + 0.0185, 0.135, backGap + 0.0145);
  // Upper cavetto neck & top chamfered wall-return fillet (135mm .. 146mm)
  s.quadraticCurveTo(0.139, backGap + 0.009, 0.143, backGap + 0.0075);
  s.lineTo(0.146, backGap + 0.004);
  s.lineTo(0.146, backGap);
  s.closePath();
  return s;
}

/**
 * Sweeps a 146mm-tall antique-profiled skirting board along a horizontal floor-plan polyline `path`
 * of `[x, z]` wall points (ordered so the room interior lies to the left of each segment tangent
 * `(dx, dz)`, i.e. outward normal `(-dz, dx)` points into the room), with true 45° mitred joints at
 * every internal and external corner.
 */
export function buildMitredWallSkirtingGeometry(
  path: ReadonlyArray<readonly [number, number]>,
  floorY = 0
): THREE.BufferGeometry {
  return buildSweptMouldingGeometry(
    createWallSkirtingBoardProfile(),
    path,
    (x, z, y) => new THREE.Vector3(x, floorY + y, z),
    8
  );
}

/**
 * Sweeps a 146mm-tall Ogee/Torus moulded skirting board along a horizontal floor-plan polyline `path`
 * of `[x, z]` wall points (ordered clockwise around the room interior so `(-dz, dx)` points into the room)
 * and returns one `THREE.BufferGeometry` per segment `i` (`path[i] -> path[i + 1]`), with true 45° mitred
 * joints at every shared vertex between consecutive segments.
 */
export function buildMitredWallSkirtingSegments(
  path: ReadonlyArray<readonly [number, number]>,
  floorY = 0,
  curveSegments = 8
): THREE.BufferGeometry[] {
  const profile = createWallSkirtingBoardProfile();
  const toSpace = (x: number, z: number, y: number): THREE.Vector3 =>
    new THREE.Vector3(x, floorY + y, z);

  const segs: Array<{ p0: THREE.Vector2; t: THREE.Vector2; n: THREE.Vector2; len: number }> = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [a0, y0] = path[i]!;
    const [a1, y1] = path[i + 1]!;
    const d = new THREE.Vector2(a1 - a0, y1 - y0);
    const len = d.length();
    const t = d.clone().divideScalar(len || 1);
    segs.push({ p0: new THREE.Vector2(a0, y0), t, n: new THREE.Vector2(-t.y, t.x), len });
  }

  const unit = new THREE.ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false, curveSegments });
  const unitFlat = unit.index ? unit.toNonIndexed() : unit;
  const src = unitFlat.getAttribute('position');
  const srcUv = unitFlat.getAttribute('uv');
  const tmp = new THREE.Vector3();

  const result: THREE.BufferGeometry[] = [];
  segs.forEach((seg, i) => {
    const positions: number[] = [];
    const uvs: number[] = [];
    const prev = i > 0 ? segs[i - 1] : undefined;
    const next = i + 1 < segs.length ? segs[i + 1] : undefined;
    const startK = prev ? -seg.n.dot(prev.t) / (1 + seg.t.dot(prev.t)) : 0;
    const endK = next ? -seg.n.dot(next.t) / (1 + seg.t.dot(next.t)) : 0;

    const o3 = toSpace(seg.p0.x, seg.p0.y, 1).sub(toSpace(seg.p0.x, seg.p0.y, 0));
    const n3 = toSpace(seg.p0.x + seg.n.x, seg.p0.y + seg.n.y, 0).sub(toSpace(seg.p0.x, seg.p0.y, 0));
    const t3 = toSpace(seg.p0.x + seg.t.x, seg.p0.y + seg.t.y, 0).sub(toSpace(seg.p0.x, seg.p0.y, 0));
    const flip = o3.dot(n3.clone().cross(t3)) < 0;

    for (let v = 0; v < src.count; v += 3) {
      const s0 = src.getZ(v);
      const s1 = src.getZ(v + 1);
      const s2 = src.getZ(v + 2);
      if (prev && s0 < 0.5 && s1 < 0.5 && s2 < 0.5) continue;
      if (next && s0 > 0.5 && s1 > 0.5 && s2 > 0.5) continue;
      const order = flip ? [v, v + 2, v + 1] : [v, v + 1, v + 2];
      for (const idx of order) {
        const d = src.getX(idx);
        const h = src.getY(idx);
        const s = src.getZ(idx);
        const along = s < 0.5 ? h * startK : seg.len + h * endK;
        const a = seg.p0.x + seg.t.x * along + seg.n.x * h;
        const y = seg.p0.y + seg.t.y * along + seg.n.y * h;
        tmp.copy(toSpace(a, y, d));
        positions.push(tmp.x, tmp.y, tmp.z);
        if (srcUv) {
          uvs.push(srcUv.getX(idx), srcUv.getY(idx) * (s < 0.5 ? 1 : seg.len));
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (uvs.length > 0) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    result.push(geo);
  });

  unit.dispose();
  if (unitFlat !== unit) unitFlat.dispose();
  return result;
}

/**
 * 92mm-wide antique oak ogee/torus doorway architrave cross-section in `(d, h)`:
 * - `d` is the projection out from the wall face (`0..0.035m`),
 * - `h` is the offset outward from the doorway sight-edge (`0..width`), with a flat inner fascia
 *   (`0..width - 0.026m` at `d = 0.035m`) stepping down via a `5.5mm` quirk, convex torus bead
 *   (`0.0315m`), concave ogee/cove neck (`0.0245m`), and `0.0225m` outer edge fillet matching
 *   the skirting board and stair stringer profile.
 */
export function createArchitraveProfile(width = 0.092, maxT = 0.022): THREE.Shape {
  // Architectural Ogee + Quirk + Torus architrave profile in `(d, h)` matching `createWallSkirtingBoardProfile()`:
  // - `d` is projection out from wall face (`0..maxT`),
  // - `h` is distance outward from the doorway sight-edge (`0..width`):
  //   * Inner flat band (`0 .. 0.44 * width`) at full projection `maxT`,
  //   * Crisp recessed quirk step (`0.44 * width .. 0.48 * width`),
  //   * Sweeping concave/convex cyma reversa Ogee throat (`0.48 * width .. 0.72 * width`),
  //   * Projecting Torus bead roll (`0.72 * width .. 0.88 * width`),
  //   * Outer cavetto & chamfered wall-return fillet (`0.88 * width .. width`).
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(maxT, 0);
  s.lineTo(maxT, width * 0.44);
  // Crisp recessed quirk step
  s.lineTo(maxT * 0.78, width * 0.46);
  s.lineTo(maxT * 0.78, width * 0.50);
  // Swept cyma reversa ogee throat
  s.quadraticCurveTo(maxT * 0.88, width * 0.56, maxT * 0.68, width * 0.63);
  s.quadraticCurveTo(maxT * 0.50, width * 0.68, maxT * 0.60, width * 0.72);
  // Projecting upper torus roll
  s.lineTo(maxT * 0.74, width * 0.73);
  s.quadraticCurveTo(maxT * 0.92, width * 0.80, maxT * 0.72, width * 0.87);
  // Outer cavetto & chamfered wall-return fillet
  s.quadraticCurveTo(maxT * 0.48, width * 0.93, maxT * 0.36, width * 0.97);
  s.lineTo(maxT * 0.22, width);
  s.lineTo(0, width);
  s.closePath();
  return s;
}

/**
 * Sweeps a 3-sided 45°-mitred Ogee/Torus doorway architrave (`[leftLeg, head, rightLeg]`)
 * along a doorway portal on a wall face (`axis = 'x'` means the opening spans X and the wall normal is Z;
 * `axis = 'z'` means the opening spans Z and the wall normal is X).
 */
export function buildMitredArchitraveSegments(
  uLeft: number,
  uRight: number,
  yLeftBot: number,
  yRightBot: number,
  yHead: number,
  axis: 'x' | 'z',
  wallFaceCoord: number,
  normalSign: 1 | -1,
  archW = 0.068,
  archT = 0.022,
  curveSegments = 8
): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry] {
  const profile = createArchitraveProfile(archW, archT);
  const path: ReadonlyArray<readonly [number, number]> = [
    [uLeft, yLeftBot],
    [uLeft, yHead],
    [uRight, yHead],
    [uRight, yRightBot],
  ];
  const toSpace = (u: number, y: number, d: number): THREE.Vector3 =>
    axis === 'x'
      ? new THREE.Vector3(u, y, wallFaceCoord + normalSign * d)
      : new THREE.Vector3(wallFaceCoord + normalSign * d, y, u);

  const segs: Array<{ p0: THREE.Vector2; t: THREE.Vector2; n: THREE.Vector2; len: number }> = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [a0, y0] = path[i]!;
    const [a1, y1] = path[i + 1]!;
    const d = new THREE.Vector2(a1 - a0, y1 - y0);
    const len = d.length();
    const t = d.clone().divideScalar(len || 1);
    segs.push({ p0: new THREE.Vector2(a0, y0), t, n: new THREE.Vector2(-t.y, t.x), len });
  }

  const unit = new THREE.ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false, curveSegments });
  const unitFlat = unit.index ? unit.toNonIndexed() : unit;
  const src = unitFlat.getAttribute('position');
  const srcUv = unitFlat.getAttribute('uv');
  const tmp = new THREE.Vector3();

  const out: THREE.BufferGeometry[] = [];
  segs.forEach((seg, i) => {
    const positions: number[] = [];
    const uvs: number[] = [];
    const prev = i > 0 ? segs[i - 1] : undefined;
    const next = i + 1 < segs.length ? segs[i + 1] : undefined;
    const startK = prev ? -seg.n.dot(prev.t) / (1 + seg.t.dot(prev.t)) : 0;
    const endK = next ? -seg.n.dot(next.t) / (1 + seg.t.dot(next.t)) : 0;

    const o3 = toSpace(seg.p0.x, seg.p0.y, 1).sub(toSpace(seg.p0.x, seg.p0.y, 0));
    const n3 = toSpace(seg.p0.x + seg.n.x, seg.p0.y + seg.n.y, 0).sub(toSpace(seg.p0.x, seg.p0.y, 0));
    const t3 = toSpace(seg.p0.x + seg.t.x, seg.p0.y + seg.t.y, 0).sub(toSpace(seg.p0.x, seg.p0.y, 0));
    const flip = o3.dot(n3.clone().cross(t3)) < 0;

    for (let v = 0; v < src.count; v += 3) {
      const s0 = src.getZ(v);
      const s1 = src.getZ(v + 1);
      const s2 = src.getZ(v + 2);
      if (prev && s0 < 0.5 && s1 < 0.5 && s2 < 0.5) continue;
      if (next && s0 > 0.5 && s1 > 0.5 && s2 > 0.5) continue;
      const order = flip ? [v, v + 2, v + 1] : [v, v + 1, v + 2];
      for (const idx of order) {
        const d = src.getX(idx);
        const h = src.getY(idx);
        const s = src.getZ(idx);
        const along = s < 0.5 ? h * startK : seg.len + h * endK;
        const a = seg.p0.x + seg.t.x * along + seg.n.x * h;
        const y = seg.p0.y + seg.t.y * along + seg.n.y * h;
        tmp.copy(toSpace(a, y, d));
        positions.push(tmp.x, tmp.y, tmp.z);
        if (srcUv) {
          uvs.push(srcUv.getX(idx), srcUv.getY(idx) * (s < 0.5 ? 1 : seg.len));
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (uvs.length > 0) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    out.push(geo);
  });

  unit.dispose();
  if (unitFlat !== unit) unitFlat.dispose();
  return [out[0]!, out[1]!, out[2]!];
}

export interface CasedArchitravePortalOptions {
  /** 'x' = opening runs along X (wall normal along Z); 'z' = opening runs along Z (wall normal along X). */
  axis: 'x' | 'z';
  /** Center coordinate of the wall along its normal axis (Z if `axis === 'x'`, X if `axis === 'z'`). */
  wallCoord: number;
  /** Thickness of the wall between its two faces. */
  wallThickness: number;
  /** Center coordinate of the doorway opening along `axis` (X if `axis === 'x'`, Z if `axis === 'z'`). */
  openingCenter: number;
  /** Clear width of the wall opening along `axis`. */
  openingWidth: number;
  /** Floor Y on the +normal face of the wall (+Z if `axis === 'x'`, +X if `axis === 'z'`). */
  frontFloorY: number;
  /** Floor Y on the -normal face of the wall (-Z if `axis === 'x'`, -X if `axis === 'z'`). Defaults to `frontFloorY`. */
  backFloorY?: number;
  /** Y coordinate of the top of the doorway opening (lintel soffit). */
  headY: number;
  /** Material for the architraves and doorway reveal lining. */
  material: THREE.Material;
  /** Architrave moulding width (defaults to `0.092`). */
  architraveWidth?: number;
  /** Optional ripped/scribed architrave width on the -axis (`left`) leg (both faces unless overridden). */
  leftArchitraveWidth?: number;
  /** Optional ripped/scribed architrave width on the +axis (`right`) leg (both faces unless overridden). */
  rightArchitraveWidth?: number;
  /** Optional ripped/scribed architrave width on the +normal (`front`) -axis (`left`) leg. */
  frontLeftArchitraveWidth?: number;
  /** Optional ripped/scribed architrave width on the +normal (`front`) +axis (`right`) leg. */
  frontRightArchitraveWidth?: number;
  /** Optional ripped/scribed architrave width on the -normal (`back`) -axis (`left`) leg. */
  backLeftArchitraveWidth?: number;
  /** Optional ripped/scribed architrave width on the -normal (`back`) +axis (`right`) leg. */
  backRightArchitraveWidth?: number;
  /** Optional ripped/scribed top head architrave width on the +normal (`front`) face (e.g. under a low ceiling soffit). */
  frontTopArchitraveWidth?: number;
  /** Optional ripped/scribed top head architrave width on the -normal (`back`) face. */
  backTopArchitraveWidth?: number;
  /** How far the clear reveal jamb steps into the opening from the raw jamb edges (defaults to `0.008`). */
  jambInset?: number;
  /** How far the clear reveal head soffit sits below `headY` (defaults to `0.006`). */
  headInset?: number;
  /** Step-back reveal quirk between clear jamb/head sightline and architrave inner edge (defaults to `0.005`). */
  revealQuirk?: number;
  /** Thickness of the solid timber reveal jamb & head lining (defaults to `Math.max(0.018, jambInset)`). */
  liningThickness?: number;
  /** Optional X-per-Z shear slope for angled walls along Z (e.g. East Courtyard Wall). */
  slopeXPerZ?: number;
  /** Whether to include the 3-sided solid timber reveal lining spanning `wallThickness` (defaults to `true`). */
  includeRevealLining?: boolean;
  /** Whether to emit 168mm-tall chamfered pedestal plinth blocks beneath vertical architrave legs (defaults to `true`). */
  includePlinthBlocks?: boolean;
  /** Whether to emit a 12 × 38mm 3-sided planted door-stop bead inside the reveal lining (defaults to `false`). */
  includeDoorStop?: boolean;
  /** Which face of the portal the hinged door swings toward (`front` = +normal, `back` = -normal; defaults to `back`). */
  doorStopHingeFace?: 'front' | 'back';
  /** Optional normal-axis offset of the closed door leaf center from `wallCoord` (defaults to `0`). */
  doorCenterOffsetN?: number;
  /** Closed door leaf thickness used to position the planted door-stop rebate cleanly (defaults to `0.046`). */
  doorLeafThickness?: number;
  /** Whether to include the +normal face architrave (defaults to `true`). */
  includeFrontArchitrave?: boolean;
  /** Whether to include the -normal face architrave (defaults to `true`). */
  includeBackArchitrave?: boolean;
  /** Extra outward offset from `wallThickness / 2` on the +normal face (e.g. `0.014` for wall cladding). */
  frontFaceOffset?: number;
  /** Extra outward offset from `-wallThickness / 2` on the -normal face (e.g. `0.014` for wall cladding). */
  backFaceOffset?: number;
  /** Vertical clearance at the bottom of the reveal jambs above `minFloorY` (defaults to `0.004`). */
  bottomClearance?: number;
  /** Optional material override for the +normal (`front`) architrave, plinth, stop & front reveal. */
  frontArchitraveMaterial?: THREE.Material;
  /** Optional material override for the -normal (`back`) architrave, plinth, stop & back reveal. */
  backArchitraveMaterial?: THREE.Material;
  /** Optional base name prefix for the generated meshes. */
  namePrefix?: string;
}

function sampleArchitraveOuterCurve(
  fullWidth: number,
  maxT: number,
  cutWidths: readonly number[],
  curveSegments = 5
): Array<readonly [number, number]> {
  const shape = createArchitraveProfile(fullWidth, maxT);
  const rawPts = shape.getPoints(curveSegments);
  // Extract the outer moulded profile points from (maxT, 0) up to (maxT * 0.22, fullWidth),
  // monotonic in h (y coordinate of the 2D shape).
  const outer: Array<[number, number]> = [];
  for (const p of rawPts) {
    if (p.x <= 1e-6 && p.y <= 1e-6) continue;
    if (p.x <= 1e-6 && Math.abs(p.y - fullWidth) <= 1e-5) continue;
    if (outer.length === 0 || p.y >= outer[outer.length - 1]![1] - 1e-6) {
      if (outer.length > 0 && Math.abs(p.y - outer[outer.length - 1]![1]) <= 1e-6 && Math.abs(p.x - outer[outer.length - 1]![0]) <= 1e-6) {
        continue;
      }
      outer.push([p.x, Math.max(0, Math.min(fullWidth, p.y))]);
    }
  }
  const evalAtH = (targetH: number): number => {
    for (let i = 0; i + 1 < outer.length; i++) {
      const [d0, h0] = outer[i]!;
      const [d1, h1] = outer[i + 1]!;
      if (targetH >= h0 - 1e-6 && targetH <= h1 + 1e-6) {
        const span = h1 - h0;
        if (Math.abs(span) < 1e-8) return d1;
        const t = Math.max(0, Math.min(1, (targetH - h0) / span));
        return d0 + (d1 - d0) * t;
      }
    }
    return maxT * 0.22;
  };
  for (const cw of cutWidths) {
    if (cw > 1e-4 && cw < fullWidth - 1e-4) {
      const exists = outer.some(([, h]) => Math.abs(h - cw) < 1e-5);
      if (!exists) {
        const dAtCut = evalAtH(cw);
        const insertIdx = outer.findIndex(([, h]) => h > cw);
        if (insertIdx >= 0) {
          outer.splice(insertIdx, 0, [dAtCut, cw]);
        } else {
          outer.push([dAtCut, cw]);
        }
      }
    }
  }
  return outer;
}

function buildScribedPortalArchitraveGeometry(
  fullWidth: number,
  maxT: number,
  leftW: number,
  rightW: number,
  uArchLeft: number,
  uArchRight: number,
  legBotY: number,
  yArchHead: number,
  toSpace: (u: number, y: number, d: number) => THREE.Vector3,
  topW: number = fullWidth
): THREE.BufferGeometry {
  const clampedLeftW = Math.max(0, Math.min(fullWidth, leftW));
  const clampedRightW = Math.max(0, Math.min(fullWidth, rightW));
  const clampedTopW = Math.max(0.004, Math.min(fullWidth, topW));
  if (
    clampedLeftW >= fullWidth - 1e-4 &&
    clampedRightW >= fullWidth - 1e-4 &&
    clampedTopW >= fullWidth - 1e-4
  ) {
    return buildSweptMouldingGeometry(
      createArchitraveProfile(fullWidth, maxT),
      [
        [uArchLeft, legBotY],
        [uArchLeft, yArchHead],
        [uArchRight, yArchHead],
        [uArchRight, legBotY],
      ],
      toSpace,
      4
    );
  }

  const outerPts = sampleArchitraveOuterCurve(
    fullWidth,
    maxT,
    [clampedLeftW, clampedRightW, clampedTopW],
    5
  );
  const makeSliceShape = (maxH: number): THREE.Shape => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    for (const [d, h] of outerPts) {
      if (h <= maxH + 1e-5) {
        s.lineTo(d, Math.min(maxH, h));
      }
    }
    s.lineTo(0, maxH);
    s.closePath();
    return s;
  };

  const positions: number[] = [];
  const uvs: number[] = [];
  const tmp = new THREE.Vector3();

  const appendSegment = (
    shape: THREE.Shape,
    segLen: number,
    mapPoint: (h: number, s: number) => readonly [number, number],
    omitStartCap: (h0: number, h1: number, h2: number) => boolean,
    omitEndCap: (h0: number, h1: number, h2: number) => boolean,
    basisOrigin: readonly [number, number],
    basisAlong: readonly [number, number],
    basisOutwardH: readonly [number, number]
  ): void => {
    const unit = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 1 });
    const unitFlat = unit.index ? unit.toNonIndexed() : unit;
    const src = unitFlat.getAttribute('position');
    const srcUv = unitFlat.getAttribute('uv');

    const o3 = toSpace(basisOrigin[0], basisOrigin[1], 1).sub(toSpace(basisOrigin[0], basisOrigin[1], 0));
    const n3 = toSpace(basisOrigin[0] + basisOutwardH[0], basisOrigin[1] + basisOutwardH[1], 0).sub(
      toSpace(basisOrigin[0], basisOrigin[1], 0)
    );
    const t3 = toSpace(basisOrigin[0] + basisAlong[0], basisOrigin[1] + basisAlong[1], 0).sub(
      toSpace(basisOrigin[0], basisOrigin[1], 0)
    );
    const flip = o3.dot(n3.clone().cross(t3)) < 0;

    for (let v = 0; v < src.count; v += 3) {
      const s0 = src.getZ(v);
      const s1 = src.getZ(v + 1);
      const s2 = src.getZ(v + 2);
      const h0 = src.getY(v);
      const h1 = src.getY(v + 1);
      const h2 = src.getY(v + 2);
      if (s0 < 0.5 && s1 < 0.5 && s2 < 0.5 && omitStartCap(h0, h1, h2)) continue;
      if (s0 > 0.5 && s1 > 0.5 && s2 > 0.5 && omitEndCap(h0, h1, h2)) continue;
      const order = flip ? [v, v + 2, v + 1] : [v, v + 1, v + 2];
      for (const idx of order) {
        const d = src.getX(idx);
        const h = src.getY(idx);
        const s = src.getZ(idx);
        const [u, y] = mapPoint(h, s);
        tmp.copy(toSpace(u, y, d));
        positions.push(tmp.x, tmp.y, tmp.z);
        if (srcUv) {
          uvs.push(srcUv.getX(idx), srcUv.getY(idx) * (s < 0.5 ? 1 : segLen));
        }
      }
    }

    unit.dispose();
    if (unitFlat !== unit) unitFlat.dispose();
  };

  // Left vertical leg (upward from legBotY to yArchHead, mitred/capped cleanly at yArchHead + clampedTopW)
  if (clampedLeftW > 0.004) {
    appendSegment(
      makeSliceShape(clampedLeftW),
      Math.max(0.05, yArchHead - legBotY),
      (h, s) => [uArchLeft - h, s < 0.5 ? legBotY : yArchHead + Math.min(h, clampedTopW)],
      () => false,
      (h0, h1, h2) => Math.max(h0, h1, h2) <= clampedTopW + 1e-5,
      [uArchLeft, legBotY],
      [0, 1],
      [-1, 0]
    );
  }

  // Top horizontal head (uArchLeft -> uArchRight, scribed flush at uArchLeft - clampedLeftW, uArchRight + clampedRightW, and yArchHead + clampedTopW)
  const uHeadMin = uArchLeft - clampedLeftW;
  const uHeadMax = uArchRight + clampedRightW;
  appendSegment(
    makeSliceShape(clampedTopW),
    Math.max(0.05, uArchRight - uArchLeft),
    (h, s) => [
      s < 0.5 ? Math.max(uHeadMin, uArchLeft - h) : Math.min(uHeadMax, uArchRight + h),
      yArchHead + h,
    ],
    (h0, h1, h2) => Math.max(h0, h1, h2) <= clampedLeftW + 1e-5,
    (h0, h1, h2) => Math.max(h0, h1, h2) <= clampedRightW + 1e-5,
    [uArchLeft, yArchHead],
    [1, 0],
    [0, 1]
  );

  // Right vertical leg (downward from yArchHead to legBotY, mitred/capped cleanly at yArchHead + clampedTopW)
  if (clampedRightW > 0.004) {
    appendSegment(
      makeSliceShape(clampedRightW),
      Math.max(0.05, yArchHead - legBotY),
      (h, s) => [uArchRight + h, s < 0.5 ? yArchHead + Math.min(h, clampedTopW) : legBotY],
      (h0, h1, h2) => Math.max(h0, h1, h2) <= clampedTopW + 1e-5,
      () => false,
      [uArchRight, yArchHead],
      [0, -1],
      [1, 0]
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uvs.length > 0) {
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function buildPedestalPlinthBlockGeometry(
  blockSpanU: number,
  plinthH: number,
  axis: 'x' | 'z',
  normalSign: 1 | -1,
  slopeXPerZ: number
): THREE.BufferGeometry {
  // Cross-section in (d, y): d = 0..0.024m proud of archWallClear (so +4..+28mm off raw wall face,
  // standing proud of 24mm skirtings and 26mm architraves), tapering over the top 8mm (0.160..0.168m)
  // via a crisp chamfered ogee shoulder from 28mm -> 25.5mm so the 26mm architrave lands cleanly!
  const maxD = 0.024;
  const topD = 0.0215;
  const shoulderH = Math.min(0.008, plinthH * 0.2);
  const bodyH = Math.max(0.01, plinthH - shoulderH);

  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(maxD, 0);
  s.lineTo(maxD, bodyH);
  s.quadraticCurveTo(maxD, bodyH + shoulderH * 0.45, topD + (maxD - topD) * 0.35, bodyH + shoulderH * 0.75);
  s.lineTo(topD, plinthH);
  s.lineTo(0, plinthH);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: blockSpanU,
    bevelEnabled: false,
    curveSegments: 4,
  });
  geo.translate(0, 0, -blockSpanU * 0.5);
  if (axis === 'x') {
    geo.rotateY(normalSign > 0 ? -Math.PI / 2 : Math.PI / 2);
  } else if (normalSign < 0) {
    geo.rotateY(Math.PI);
  }
  if (axis === 'z' && Math.abs(slopeXPerZ) > 1e-6) {
    const pos = geo.attributes.position;
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, pos.getX(i) + slopeXPerZ * pos.getZ(i));
      }
      pos.needsUpdate = true;
    }
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Adds a 3-sided doorway reveal lining (`left jamb`, `right jamb`, `top head soffit`),
 * optional `12 × 38mm` planted door-stop bead, `168mm` chamfered pedestal plinth blocks,
 * and `5mm`-quirked 45°-mitred (or tight-corner scribed) ogee/torus architraves on both faces.
 */
export function addCasedArchitravePortal(
  parent: THREE.Object3D,
  options: CasedArchitravePortalOptions
): void {
  const width = options.architraveWidth ?? 0.092;
  const jambInset = options.jambInset ?? 0.008;
  const headInset = options.headInset ?? 0.006;
  const quirk = options.revealQuirk ?? 0.005;
  const frontFloorY = options.frontFloorY;
  const backFloorY = options.backFloorY ?? frontFloorY;
  const minFloorY = Math.min(frontFloorY, backFloorY);
  const uClearLeft = options.openingCenter - options.openingWidth / 2 + jambInset;
  const uClearRight = options.openingCenter + options.openingWidth / 2 - jambInset;
  const liningT = options.liningThickness ?? Math.max(0.018, jambInset);
  const hasRevealLining = options.includeRevealLining !== false;
  const headTopY = options.headY - 0.004;
  const innerHeadY = hasRevealLining
    ? Math.min(options.headY - headInset, headTopY - liningT)
    : options.headY - headInset;
  const uArchLeft = uClearLeft - quirk;
  const uArchRight = uClearRight + quirk;
  const yArchHead = innerHeadY + quirk;
  const slope = options.slopeXPerZ ?? 0;
  const prefix = options.namePrefix ?? 'architravePortal';

  const halfWall = options.wallThickness / 2;
  const frontWallN = halfWall + (options.frontFaceOffset ?? 0);
  const backWallN = -halfWall - (options.backFaceOffset ?? 0);

  const frontMat = options.frontArchitraveMaterial ?? options.material;
  const backMat = options.backArchitraveMaterial ?? options.material;
  const splitReveal = frontMat !== backMat;

  const hasDoorStop = Boolean(options.includeDoorStop) && hasRevealLining;
  const hingeFace = options.doorStopHingeFace ?? 'back';
  const stopSign: 1 | -1 = hingeFace === 'front' ? -1 : 1;
  const leafCenterN = options.doorCenterOffsetN ?? 0;
  const leafT = options.doorLeafThickness ?? 0.046;
  const stopThickness = 0.012;
  const liningMinN = backWallN + 0.004;
  const liningMaxN = frontWallN - 0.004;
  const stopRebateN = leafCenterN + stopSign * (leafT * 0.5 + 0.0005);
  const availStopDepth = stopSign > 0 ? liningMaxN - stopRebateN : stopRebateN - liningMinN;
  const stopW = Math.min(0.038, Math.max(0.016, availStopDepth - 0.002));
  const stopCenterN = stopRebateN + stopSign * (stopW * 0.5);

  if (hasRevealLining) {
    const liningDepth = Math.max(0.02, liningMaxN - liningMinN);
    const liningCenterN = (liningMinN + liningMaxN) * 0.5;
    const jambBotY = minFloorY + (options.bottomClearance ?? 0.004);
    const jambTopY = innerHeadY - 0.004;
    const jambH = Math.max(0.05, jambTopY - jambBotY);
    const jambY = jambBotY + jambH / 2;

    const seamN = hasDoorStop
      ? Math.max(liningMinN + 0.008, Math.min(liningMaxN - 0.008, stopCenterN))
      : liningCenterN;

    const revealSlices: ReadonlyArray<readonly [number, number, THREE.Material, string]> = splitReveal
      ? [
          [Math.max(0.008, liningMaxN - seamN), (seamN + liningMaxN) * 0.5, frontMat, '.front'],
          [Math.max(0.008, seamN - liningMinN), (liningMinN + seamN) * 0.5, backMat, '.back'],
        ]
      : [[liningDepth, liningCenterN, frontMat, '']];

    for (const [sliceDepth, sliceCenterN, sliceMat, sliceSuffix] of revealSlices) {
      for (const side of [-1, 1] as const) {
        const uJamb = side < 0 ? uClearLeft - liningT / 2 : uClearRight + liningT / 2;
        const revealJamb = new THREE.Mesh(
          options.axis === 'x'
            ? new THREE.BoxGeometry(liningT, jambH, sliceDepth)
            : new THREE.BoxGeometry(sliceDepth, jambH, liningT),
          sliceMat
        );
        revealJamb.name = `${prefix}.revealJamb${sliceSuffix}`;
        if (options.axis === 'x') {
          revealJamb.position.set(uJamb, jambY, options.wallCoord + sliceCenterN);
        } else {
          revealJamb.position.set(
            options.wallCoord + sliceCenterN + slope * (uJamb - options.openingCenter),
            jambY,
            uJamb
          );
        }
        revealJamb.castShadow = true;
        revealJamb.receiveShadow = true;
        revealJamb.userData.isArchitecturalShell = true;
        parent.add(revealJamb);
      }

      const headSpan = Math.max(0.05, uClearRight - uClearLeft + liningT * 2);
      const headGeo =
        options.axis === 'x'
          ? new THREE.BoxGeometry(headSpan, liningT, sliceDepth)
          : new THREE.BoxGeometry(sliceDepth, liningT, headSpan);
      if (options.axis === 'z' && Math.abs(slope) > 1e-6) {
        const pos = headGeo.attributes.position;
        if (pos) {
          for (let i = 0; i < pos.count; i++) {
            pos.setX(i, pos.getX(i) + slope * pos.getZ(i));
          }
          pos.needsUpdate = true;
          headGeo.computeVertexNormals();
        }
      }
      const revealHead = new THREE.Mesh(headGeo, sliceMat);
      revealHead.name = `${prefix}.revealHead${sliceSuffix}`;
      if (options.axis === 'x') {
        revealHead.position.set(
          options.openingCenter,
          innerHeadY + liningT / 2,
          options.wallCoord + sliceCenterN
        );
      } else {
        revealHead.position.set(
          options.wallCoord + sliceCenterN,
          innerHeadY + liningT / 2,
          options.openingCenter
        );
      }
      revealHead.castShadow = true;
      revealHead.receiveShadow = true;
      revealHead.userData.isArchitecturalShell = true;
      parent.add(revealHead);
    }

    if (hasDoorStop && uClearRight - uClearLeft > 0.12) {
      const stopMat = stopSign > 0 ? frontMat : backMat;
      const stopBotY = jambBotY;
      const stopJambTopY = innerHeadY - stopThickness;
      const stopJambH = Math.max(0.05, stopJambTopY - stopBotY);
      const stopJambMidY = stopBotY + stopJambH * 0.5;

      for (const side of [-1, 1] as const) {
        const uStop =
          side < 0 ? uClearLeft + stopThickness * 0.5 : uClearRight - stopThickness * 0.5;
        const stopJamb = new THREE.Mesh(
          options.axis === 'x'
            ? new THREE.BoxGeometry(stopThickness, stopJambH, stopW)
            : new THREE.BoxGeometry(stopW, stopJambH, stopThickness),
          stopMat
        );
        stopJamb.name = `${prefix}.doorStopJamb.${side < 0 ? 'left' : 'right'}`;
        if (options.axis === 'x') {
          stopJamb.position.set(uStop, stopJambMidY, options.wallCoord + stopCenterN);
        } else {
          stopJamb.position.set(
            options.wallCoord + stopCenterN + slope * (uStop - options.openingCenter),
            stopJambMidY,
            uStop
          );
        }
        stopJamb.castShadow = true;
        stopJamb.receiveShadow = true;
        stopJamb.userData.isArchitecturalShell = true;
        parent.add(stopJamb);
      }

      const stopHeadSpan = Math.max(0.05, uClearRight - uClearLeft);
      const stopHeadGeo =
        options.axis === 'x'
          ? new THREE.BoxGeometry(stopHeadSpan, stopThickness, stopW)
          : new THREE.BoxGeometry(stopW, stopThickness, stopHeadSpan);
      if (options.axis === 'z' && Math.abs(slope) > 1e-6) {
        const pos = stopHeadGeo.attributes.position;
        if (pos) {
          for (let i = 0; i < pos.count; i++) {
            pos.setX(i, pos.getX(i) + slope * pos.getZ(i));
          }
          pos.needsUpdate = true;
          stopHeadGeo.computeVertexNormals();
        }
      }
      const stopHead = new THREE.Mesh(stopHeadGeo, stopMat);
      stopHead.name = `${prefix}.doorStopHead`;
      if (options.axis === 'x') {
        stopHead.position.set(
          options.openingCenter,
          innerHeadY - stopThickness * 0.5,
          options.wallCoord + stopCenterN
        );
      } else {
        stopHead.position.set(
          options.wallCoord + stopCenterN,
          innerHeadY - stopThickness * 0.5,
          options.openingCenter
        );
      }
      stopHead.castShadow = true;
      stopHead.receiveShadow = true;
      stopHead.userData.isArchitecturalShell = true;
      parent.add(stopHead);
    }
  }

  const archWallClear = 0.004;
  const archFloorClear = 0.004;
  const plinthH = 0.168; // Y = floorY + 0.004 .. floorY + 0.172m
  const maxArchT = 0.022;

  const emitPortalFace = (
    normalSign: 1 | -1,
    faceWallN: number,
    faceFloorY: number,
    faceMat: THREE.Material,
    leftLegW: number,
    rightLegW: number,
    topHeadW: number,
    faceLabel: 'front' | 'back'
  ): void => {
    const usePlinth =
      options.includePlinthBlocks !== false &&
      (options.bottomClearance ?? 0.004) <= 0.05 &&
      yArchHead - faceFloorY > 0.35;
    const legBotY = usePlinth ? faceFloorY + archFloorClear + plinthH : faceFloorY + archFloorClear;

    if (usePlinth) {
      for (const [side, legW, sideTag] of [
        [-1, leftLegW, 'left'],
        [1, rightLegW, 'right'],
      ] as const) {
        if (legW <= 0.006) continue;
        const innerMargin = Math.min(0.003, Math.max(0, quirk - 0.001));
        const outerMargin = legW < width - 1e-4 ? 0 : 0.003;
        const blockSpan = legW + innerMargin + outerMargin;
        const uInner = side < 0 ? uArchLeft + innerMargin : uArchRight - innerMargin;
        const uOuter = side < 0 ? uArchLeft - legW - outerMargin : uArchRight + legW + outerMargin;
        const uBlockMid = (uInner + uOuter) * 0.5;
        const plinthGeo = buildPedestalPlinthBlockGeometry(
          blockSpan,
          plinthH,
          options.axis,
          normalSign,
          slope
        );
        const plinthMesh = new THREE.Mesh(plinthGeo, faceMat);
        plinthMesh.name = `${prefix}.${faceLabel}PlinthBlock.${sideTag}`;
        const baseN = options.wallCoord + faceWallN + normalSign * archWallClear;
        if (options.axis === 'x') {
          plinthMesh.position.set(uBlockMid, faceFloorY + archFloorClear, baseN);
        } else {
          plinthMesh.position.set(
            baseN + slope * (uBlockMid - options.openingCenter),
            faceFloorY + archFloorClear,
            uBlockMid
          );
        }
        plinthMesh.castShadow = true;
        plinthMesh.receiveShadow = true;
        plinthMesh.userData.isArchitecturalShell = true;
        parent.add(plinthMesh);
      }
    }

    const archGeo = buildScribedPortalArchitraveGeometry(
      width,
      maxArchT,
      leftLegW,
      rightLegW,
      uArchLeft,
      uArchRight,
      legBotY,
      yArchHead,
      (u, y, d) =>
        options.axis === 'x'
          ? new THREE.Vector3(u, y, options.wallCoord + faceWallN + normalSign * (archWallClear + d))
          : new THREE.Vector3(
              options.wallCoord +
                slope * (u - options.openingCenter) +
                faceWallN +
                normalSign * (archWallClear + d),
              y,
              u
            ),
      topHeadW
    );
    const archMesh = new THREE.Mesh(archGeo, faceMat);
    archMesh.name = `${prefix}.${faceLabel}Architrave`;
    archMesh.castShadow = true;
    archMesh.receiveShadow = true;
    archMesh.userData.isArchitecturalShell = true;
    parent.add(archMesh);
  };

  if (options.includeFrontArchitrave !== false) {
    const frontLeftW =
      options.frontLeftArchitraveWidth ?? options.leftArchitraveWidth ?? width;
    const frontRightW =
      options.frontRightArchitraveWidth ?? options.rightArchitraveWidth ?? width;
    const frontTopW = options.frontTopArchitraveWidth ?? width;
    emitPortalFace(1, frontWallN, frontFloorY, frontMat, frontLeftW, frontRightW, frontTopW, 'front');
  }

  if (options.includeBackArchitrave !== false) {
    const backLeftW =
      options.backLeftArchitraveWidth ?? options.leftArchitraveWidth ?? width;
    const backRightW =
      options.backRightArchitraveWidth ?? options.rightArchitraveWidth ?? width;
    const backTopW = options.backTopArchitraveWidth ?? width;
    emitPortalFace(-1, backWallN, backFloorY, backMat, backLeftW, backRightW, backTopW, 'back');
  }
}

/**
 * Crown cornice cross-section in `(d, h)` for floor-to-ceiling Shaker cabinetry & vaulted wardrobes:
 * - `d` (`0..projection`) projects outward from the cabinetry front face,
 * - `h` (`-height..+0.004`) hangs downward from the ceiling line (`h = 0`) when swept along an increasing
 *   horizontal/raked ceiling path `(u0, y0) -> (u1, y1)`.
 */
export function createCrownCorniceProfile(projection = 0.042, height = 0.046): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.004, -height);
  s.lineTo(projection * 0.30, -height);
  s.lineTo(projection * 0.30, -height * 0.78);
  s.lineTo(projection * 0.42, -height * 0.74);
  s.quadraticCurveTo(projection * 0.36, -height * 0.54, projection * 0.62, -height * 0.38);
  s.quadraticCurveTo(projection * 0.88, -height * 0.22, projection, -height * 0.14);
  s.lineTo(projection, 0.004);
  s.lineTo(-0.004, 0.004);
  s.closePath();
  return s;
}

/**
 * Sweeps a classical Shaker cyma-recta + cavetto joinery crown cornice along a horizontal `[x, z]`
 * cabinet/alcove perimeter `path` (ordered counter-clockwise in `(X, Z)` when viewed from `+Y`, so
 * `(-dz, dx)` points outward over the cabinet front & side cheeks) with true `45°` outside/inside
 * corner miters.
 */
export function buildMitredCabinetCrownCorniceGeometry(
  path: ReadonlyArray<readonly [number, number]>,
  baseY: number,
  projection = 0.048,
  height = 0.078,
  backSeatDepth = 0.022
): THREE.BufferGeometry {
  // Profile in (yRel, hOut): yRel = 0..height above baseY, hOut = -backSeatDepth..+projection outward
  const s = new THREE.Shape();
  s.moveTo(0, -backSeatDepth);
  // Lower bed-mould fascia & crisp quirk step
  s.lineTo(0, projection * 0.22);
  s.lineTo(height * 0.18, projection * 0.22);
  s.lineTo(height * 0.22, projection * 0.36);
  // Concave cavetto throat sweeping into convex cyma-recta crown belly
  s.quadraticCurveTo(height * 0.42, projection * 0.30, height * 0.58, projection * 0.58);
  s.quadraticCurveTo(height * 0.76, projection * 0.88, height * 0.84, projection);
  // Crisp vertical corona fascia & top soffit return
  s.lineTo(height, projection);
  s.lineTo(height, -backSeatDepth);
  s.closePath();

  return buildSweptMouldingGeometry(
    s,
    path,
    (x, z, yRel) => new THREE.Vector3(x, baseY + yRel, z),
    8
  );
}

export interface SolidOakWindowTrimOptions {
  /** 'x' = window spans X (wall normal along Z); 'z' = window spans Z (wall normal along X). */
  readonly axis: 'x' | 'z';
  /** Center coordinate of the window opening along `axis` (X if `axis === 'x'`, Z if `axis === 'z'`). */
  readonly openingCenter: number;
  /** Clear width of the masonry/plaster window reveal opening along `axis`. */
  readonly openingWidth: number;
  /** Y coordinate of the masonry sill (bottom of window reveal). */
  readonly sillY: number;
  /** Y coordinate of the masonry head (top of window reveal). */
  readonly headY: number;
  /** Interior room-side wall face coordinate (Z if `axis === 'x'`, X at `openingCenter` if `axis === 'z'`). */
  readonly interiorWallFaceCoord: number;
  /** Sign pointing from the wall into the interior room (+1 or -1). */
  readonly inwardSign: 1 | -1;
  /** Depth of the interior plastered reveal from window frame to interior wall face. */
  readonly revealDepth: number;
  /** Crisp white window trim material (`windowFrameMat` / `crispWhiteWallMat`). */
  readonly material: THREE.Material;
  /** Prefix for mesh names (e.g. `winId`). */
  readonly namePrefix: string;
  /** Architrave moulding width (`75 mm` per Survey2Plan / client joinery schedule, default `0.075`). */
  readonly architraveWidth?: number;
  /** Architrave maximum projection thickness (`20 mm`, default `0.020`). */
  readonly architraveThickness?: number;
  /** Extra room-ward offset to clear applied wall panelling or timber linings (default `0`). */
  readonly trimFaceOffset?: number;
  /** Optional X-per-Z shear slope for angled walls along Z (e.g. East Courtyard Wall, default `0`). */
  readonly slopeXPerZ?: number;
  /** Whether to omit the moulded under-sill apron (e.g. above a built-in window seat). */
  readonly skipUnderApron?: boolean;
  /** Whether to omit the 3-sided 45°-mitred window architrave (default `false`). */
  readonly skipArchitrave?: boolean;
}

/**
 * Adds internal window trim:
 * 1. `24 mm` thick bullnose window board (`R = 12mm` half-round front edge) with `30 mm` returned horns,
 * 2. `5 mm`-quirked 3-sided 45°-mitred `75 mm × 20 mm` Ogee/Torus window architrave seated flush on the board,
 * 3. Moulded `18 × 36 mm` Ogee/Cavetto under-sill apron flush beneath the window board.
 */
export function addSolidOakWindowTrim(
  parent: THREE.Object3D,
  options: SolidOakWindowTrimOptions
): void {
  const archW = options.architraveWidth ?? 0.075;
  const archT = options.architraveThickness ?? 0.020;
  const faceOffset = options.trimFaceOffset ?? 0;
  const wallClear = 0.004;
  const slope = options.slopeXPerZ ?? 0;
  const effWallFace = options.interiorWallFaceCoord + options.inwardSign * (faceOffset + wallClear);
  const jambInset = 0.006;
  const quirk = 0.005;
  const uLeft = options.openingCenter - options.openingWidth * 0.5 + jambInset;
  const uRight = options.openingCenter + options.openingWidth * 0.5 - jambInset;
  const uArchLeft = uLeft - quirk;
  const uArchRight = uRight + quirk;
  const uArchOuterLeft = options.skipArchitrave ? uLeft : uArchLeft - archW;
  const uArchOuterRight = options.skipArchitrave ? uRight : uArchRight + archW;

  // 24mm R=12mm half-round bullnose window board with 30mm returned horns on each side
  const sillWidth = Math.max(0.12, uArchOuterRight - uArchOuterLeft + 0.060);
  const boardH = 0.024;
  const boardBotY = options.sillY + 0.004;
  const boardTopY = boardBotY + boardH;
  const backDepth = Math.max(0.036, options.revealDepth - 0.064 + faceOffset + wallClear);
  const nosingProj = Math.max(0.014, archT + 0.014 - wallClear);
  const bullnoseR = 0.012;

  const boardShape = new THREE.Shape();
  boardShape.moveTo(-backDepth, 0);
  boardShape.lineTo(nosingProj - bullnoseR, 0);
  boardShape.absarc(nosingProj - bullnoseR, bullnoseR, bullnoseR, -Math.PI * 0.5, Math.PI * 0.5, false);
  boardShape.lineTo(-backDepth, boardH);
  boardShape.closePath();

  const boardGeo = new THREE.ExtrudeGeometry(boardShape, {
    depth: sillWidth,
    bevelEnabled: false,
    curveSegments: 10,
  });
  boardGeo.translate(0, 0, -sillWidth * 0.5);
  if (options.axis === 'x') {
    boardGeo.rotateY(options.inwardSign > 0 ? -Math.PI / 2 : Math.PI / 2);
  } else if (options.inwardSign < 0) {
    boardGeo.rotateY(Math.PI);
  }
  if (options.axis === 'z' && Math.abs(slope) > 1e-6) {
    const pos = boardGeo.attributes.position;
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, pos.getX(i) + slope * pos.getZ(i));
      }
      pos.needsUpdate = true;
    }
  }
  boardGeo.computeVertexNormals();
  boardGeo.computeBoundingSphere();

  const windowBoard = new THREE.Mesh(boardGeo, options.material);
  windowBoard.name = `${options.namePrefix}.windowBoard`;
  if (options.axis === 'x') {
    windowBoard.position.set(options.openingCenter, boardBotY, effWallFace);
  } else {
    windowBoard.position.set(effWallFace, boardBotY, options.openingCenter);
  }
  windowBoard.castShadow = true;
  windowBoard.receiveShadow = true;
  parent.add(windowBoard);

  // 3-sided 45°-mitred window architrave stepped back by a 5mm reveal quirk, seated flush on the board
  const archBotY = boardTopY;
  if (!options.skipArchitrave && uArchRight - uArchLeft > 0.08 && options.headY - archBotY > 0.12) {
    const innerHeadY = options.headY - 0.006 + quirk;
    const archProfile = createArchitraveProfile(archW, archT);
    const archPath: ReadonlyArray<readonly [number, number]> = [
      [uArchLeft, archBotY],
      [uArchLeft, innerHeadY],
      [uArchRight, innerHeadY],
      [uArchRight, archBotY],
    ];
    const archGeo = buildSweptMouldingGeometry(
      archProfile,
      archPath,
      (u, y, d) =>
        options.axis === 'x'
          ? new THREE.Vector3(u, y, effWallFace + options.inwardSign * d)
          : new THREE.Vector3(
              effWallFace + slope * (u - options.openingCenter) + options.inwardSign * d,
              y,
              u
            ),
      6
    );
    const oakArchitrave = new THREE.Mesh(archGeo, options.material);
    oakArchitrave.name = `${options.namePrefix}.oakArchitrave`;
    oakArchitrave.castShadow = true;
    oakArchitrave.receiveShadow = true;
    oakArchitrave.userData.isArchitecturalShell = true;
    parent.add(oakArchitrave);
  }

  // Moulded 18 × 36mm ogee under-sill apron seated flush beneath the window board
  if (!options.skipUnderApron) {
    const apronSpan = Math.max(0.12, uArchOuterRight - uArchOuterLeft);
    const apronH = 0.036;
    const apronT = 0.018;
    const apronShape = new THREE.Shape();
    apronShape.moveTo(0, 0);
    apronShape.lineTo(apronT * 0.25, 0);
    apronShape.lineTo(apronT * 0.25, apronH * 0.08);
    apronShape.quadraticCurveTo(apronT * 0.48, apronH * 0.22, apronT * 0.78, apronH * 0.42);
    apronShape.quadraticCurveTo(apronT * 1.02, apronH * 0.62, apronT * 0.86, apronH * 0.80);
    apronShape.lineTo(apronT, apronH * 0.84);
    apronShape.lineTo(apronT, apronH);
    apronShape.lineTo(0, apronH);
    apronShape.closePath();

    const apronGeo = new THREE.ExtrudeGeometry(apronShape, {
      depth: apronSpan,
      bevelEnabled: false,
      curveSegments: 8,
    });
    apronGeo.translate(0, 0, -apronSpan * 0.5);
    if (options.axis === 'x') {
      apronGeo.rotateY(options.inwardSign > 0 ? -Math.PI / 2 : Math.PI / 2);
    } else if (options.inwardSign < 0) {
      apronGeo.rotateY(Math.PI);
    }
    if (options.axis === 'z' && Math.abs(slope) > 1e-6) {
      const pos = apronGeo.attributes.position;
      if (pos) {
        for (let i = 0; i < pos.count; i++) {
          pos.setX(i, pos.getX(i) + slope * pos.getZ(i));
        }
        pos.needsUpdate = true;
      }
    }
    apronGeo.computeVertexNormals();
    apronGeo.computeBoundingSphere();

    const oakApron = new THREE.Mesh(apronGeo, options.material);
    oakApron.name = `${options.namePrefix}.oakUnderSillApron`;
    if (options.axis === 'x') {
      oakApron.position.set(options.openingCenter, boardBotY - apronH, effWallFace);
    } else {
      oakApron.position.set(effWallFace, boardBotY - apronH, options.openingCenter);
    }
    oakApron.castShadow = true;
    oakApron.receiveShadow = true;
    oakApron.userData.tradeCategory = 'finishes';
    parent.add(oakApron);
  }
}
