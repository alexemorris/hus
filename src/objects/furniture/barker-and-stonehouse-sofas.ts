import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Builds a tailored rectangular upholstery cushion or pillow geometry using a multi-segment
 * physical-radius RoundedBoxGeometry with subtle face crowning (not bubbly/spherical and not a sharp 90° cube).
 */
export function createSculptedCushionGeometry(
  widthX: number,
  heightY: number,
  depthZ: number,
  _segX: number,
  _segY: number,
  _segZ: number,
  crownPower: number,
  uvMode: 'striped' | 'standard',
  knifeEdge = false,
  loungeCrease = 0
): THREE.BufferGeometry {
  const minDim = Math.min(widthX, heightY, depthZ);
  // Physical seam fillet radius (in meters):
  // - Structured sofa decks/bases/arms (crownPower <= 0.44): ~1.5cm..1.8cm crisp upholstered bevel
  // - Tailored seat & back cushions (crownPower > 0.44): ~2.2cm..2.5cm rounded cushion edge
  // - Knife-edge throw pillows: ~1.8cm..2.2cm rounded edge
  const bevelRadius = knifeEdge
    ? Math.min(minDim * 0.22, 0.022)
    : crownPower <= 0.44
      ? Math.min(minDim * 0.14, 0.018)
      : Math.min(minDim * 0.16, 0.025);

  const geo = new RoundedBoxGeometry(widthX, heightY, depthZ, 4, bevelRadius);
  geo.userData.isSculpted = true;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;

  const hx = widthX * 0.5;
  const hy = heightY * 0.5;
  const hz = depthZ * 0.5;
  const stripeScale = 1.25;

  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    const z0 = pos.getZ(i);

    const nx0 = norm.getX(i);
    const ny0 = norm.getY(i);

    const ux = hx > 1e-5 ? x0 / hx : 0;
    const uy = hy > 1e-5 ? y0 / hy : 0;
    const uz = hz > 1e-5 ? z0 / hz : 0;

    const ax = Math.min(1, Math.abs(ux));
    const ay = Math.min(1, Math.abs(uy));
    const az = Math.min(1, Math.abs(uz));

    const domeY = Math.cos(ax * Math.PI * 0.5) * Math.cos(az * Math.PI * 0.5);
    const domeX = Math.cos(ay * Math.PI * 0.5) * Math.cos(az * Math.PI * 0.5);
    const domeZ = Math.cos(ax * Math.PI * 0.5) * Math.cos(ay * Math.PI * 0.5);

    let x = x0;
    let y = y0;
    let z = z0;

    if (knifeEdge) {
      // Gentle perimeter taper toward the seam without turning the pillow into a sphere
      const perimeterPinch =
        (1 - 0.24 * Math.pow(ay, 2.8)) * (1 - 0.22 * Math.pow(az, 2.8));
      x = x0 * perimeterPinch + Math.sign(ux) * Math.min(hx * 0.12, 0.008) * crownPower * domeX;
      y += Math.sign(uy) * Math.min(hy * 0.04, 0.004) * crownPower * domeY;
      z += Math.sign(uz) * Math.min(hz * 0.04, 0.004) * crownPower * domeZ;
    } else {
      // Subtle tailored upholstery crown (~5mm on top of seat cushions, flat bottom, ~2mm on cheeks)
      const topLift =
        uy > 0
          ? Math.min(hy * 0.06, 0.0065) * crownPower * domeY
          : Math.sign(uy) * Math.min(hy * 0.015, 0.0015) * crownPower * domeY;
      x += Math.sign(ux) * Math.min(hx * 0.02, 0.0025) * crownPower * domeX;
      y += topLift;
      z += Math.sign(uz) * Math.min(hz * 0.02, 0.0025) * crownPower * domeZ;
    }

    if (loungeCrease > 0) {
      const centerBell =
        Math.cos(ay * Math.PI * 0.5) * Math.cos(az * Math.PI * 0.5);
      x -= ux * hx * loungeCrease * 0.35 * centerBell;
      if (uy > 0) {
        y -= hy * loungeCrease * 0.14 * Math.cos(az * Math.PI * 0.5) * uy;
      }
    }

    pos.setXYZ(i, x, y, z);

    if (uvMode === 'striped') {
      if (Math.abs(nx0) > 0.5) {
        uv.setXY(i, z * stripeScale, y * stripeScale);
      } else if (Math.abs(ny0) > 0.5) {
        uv.setXY(i, z * stripeScale, x * stripeScale);
      } else {
        uv.setXY(i, x * stripeScale, y * stripeScale);
      }
    }
  }

  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a continuous rounded piping / welt cord frame in the Y-Z or X-Z plane.
 */
export function createPerimeterWeltLoop(
  lengthA: number,
  lengthB: number,
  radius: number,
  plane: 'XZ' | 'YZ',
  mat: THREE.Material,
  namePrefix: string
): THREE.Group {
  const group = new THREE.Group();
  group.name = namePrefix;
  const radialSegs = 6;

  if (plane === 'XZ') {
    const halfX = lengthA * 0.5;
    const halfZ = lengthB * 0.5;
    // Front & back rails along Z
    for (const sx of [-1, 1] as const) {
      const railZ = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, lengthB, radialSegs),
        mat
      );
      railZ.name = `${namePrefix}.railZ.${sx < 0 ? 'west' : 'east'}`;
      railZ.rotation.x = Math.PI * 0.5;
      railZ.position.set(sx * halfX, 0, 0);
      group.add(railZ);
    }
    // Left & right rails along X
    for (const sz of [-1, 1] as const) {
      const railX = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, lengthA, radialSegs),
        mat
      );
      railX.name = `${namePrefix}.railX.${sz < 0 ? 'north' : 'south'}`;
      railX.rotation.z = Math.PI * 0.5;
      railX.position.set(0, 0, sz * halfZ);
      group.add(railX);
    }
    // Rounded corner joints
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const corner = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 1.04, 6, 6),
          mat
        );
        corner.name = `${namePrefix}.corner.${sx < 0 ? 'w' : 'e'}${sz < 0 ? 'n' : 's'}`;
        corner.userData.lodTier = 'high';
        corner.userData.lodMaxDistance = 12;
        corner.position.set(sx * halfX, 0, sz * halfZ);
        group.add(corner);
      }
    }
  } else {
    const halfY = lengthA * 0.5;
    const halfZ = lengthB * 0.5;
    // Top & bottom rails along Z
    for (const sy of [-1, 1] as const) {
      const railZ = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, lengthB, radialSegs),
        mat
      );
      railZ.name = `${namePrefix}.railZ.${sy < 0 ? 'bottom' : 'top'}`;
      railZ.rotation.x = Math.PI * 0.5;
      railZ.position.set(0, sy * halfY, 0);
      group.add(railZ);
    }
    // Side vertical rails along Y
    for (const sz of [-1, 1] as const) {
      const railY = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, lengthA, radialSegs),
        mat
      );
      railY.name = `${namePrefix}.railY.${sz < 0 ? 'north' : 'south'}`;
      railY.position.set(0, 0, sz * halfZ);
      group.add(railY);
    }
    for (const sy of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const corner = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 1.04, 6, 6),
          mat
        );
        corner.name = `${namePrefix}.corner.${sy < 0 ? 'b' : 't'}${sz < 0 ? 'n' : 's'}`;
        corner.userData.lodTier = 'high';
        corner.userData.lodMaxDistance = 12;
        corner.position.set(0, sy * halfY, sz * halfZ);
        group.add(corner);
      }
    }
  }

  return group;
}
