import * as THREE from 'three';

/**
 * Dedicated helper that constructs a high-LOD sculpted lyrate / violin-shaped
 * Fiddle-Leaf Fig (`Ficus lyrata`) leaf blade using a subdivided 14 x 22
 * BufferGeometry grid with:
 * - Narrow sub-cordate base (t = 0..0.25)
 * - Characteristic pinched violin waist (t = 0.38)
 * - Broad obovate/lobed upper apex (t = 0.72)
 * - Wavy/undulating leaf margins (`Math.sin(t * Math.PI * 5)`)
 * - V-shaped cross-sectional cupping toward the central midrib (`Math.abs(s) * cupDepth`)
 * - Natural parabolic longitudinal arch/droop along `t` (`-t * t * archDrop`)
 * - Raised pinnate herringbone lateral vein relief
 */
export function createFiddleLeafGeometry(
  length: number,
  maxWidth: number,
  archDrop: number,
  cupDepth: number
): THREE.BufferGeometry {
  const segsS = 14;
  const segsT = 22;
  const stride = segsS + 1;
  const vertexCount = (segsS + 1) * (segsT + 1);

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let it = 0; it <= segsT; it++) {
    const t = it / segsT; // 0 = leaf base at petiole, 1 = leaf apex tip

    // Authentic lyrate / violin-shaped Fiddle-Leaf Fig half-width profile:
    // - Sub-cordate rounded base lobe peaking around t = 0.18
    // - Distinct pinched violin waist around t = 0.38
    // - Broad obovate upper lobe peaking around t = 0.72
    // - Bluntly rounded / slightly cusped apex closing to 0 at t = 1.0
    const baseEnvelope = Math.sin(Math.pow(t, 0.68) * Math.PI);
    const basalLobe = 0.24 * Math.exp(-Math.pow((t - 0.17) / 0.11, 2));
    const violinWaistPinch = -0.31 * Math.exp(-Math.pow((t - 0.38) / 0.11, 2));
    const upperFiddleLobe = 0.42 * Math.exp(-Math.pow((t - 0.72) / 0.18, 2));
    const apexTipNotch = -0.08 * Math.exp(-Math.pow((t - 0.98) / 0.035, 2));

    const widthFactor = THREE.MathUtils.clamp(
      baseEnvelope * (0.72 + basalLobe + violinWaistPinch + upperFiddleLobe + apexTipNotch),
      0.0,
      1.15
    );
    const halfW = maxWidth * 0.5 * widthFactor;

    for (let is = 0; is <= segsS; is++) {
      const s = (is / segsS) * 2 - 1; // -1 = left margin, 0 = central midrib, +1 = right margin
      const absS = Math.abs(s);

      // Sub-cordate ear notch right at the very base (t < 0.08)
      const cordateBasePull =
        t < 0.08
          ? -0.012 * length * (1 - t / 0.08) * Math.sin(absS * Math.PI)
          : 0;

      const z = t * length + cordateBasePull;
      const x = s * halfW;

      // V-shaped cross-sectional cupping toward the central midrib + gentle recurved margin
      const crossCupY =
        (absS * 0.75 + 0.25 * Math.sin(absS * Math.PI * 0.5)) *
        cupDepth *
        Math.sin(t * Math.PI);

      // Parabolic longitudinal arch/droop along t
      const archY = (0.22 * t - t * t) * archDrop;

      // Characteristic wavy/undulating Fiddle-Leaf Fig leaf margins (strongest near outer edges)
      const marginUndulationY =
        Math.pow(absS, 1.45) *
        Math.sin(t * Math.PI * 5 + (s >= 0 ? 0.25 : -0.25)) *
        0.011 *
        Math.sin(t * Math.PI);

      // Subtle embossed herringbone pinnate lateral veins radiating at ~45 deg from midrib
      const veinWave = Math.cos((t * 8.5 - absS * 2.6) * Math.PI * 2);
      const veinReliefY =
        veinWave * 0.0018 * (1 - absS * 0.5) * Math.sin(t * Math.PI);

      const y = crossCupY + archY + marginUndulationY + veinReliefY;

      const idx = it * stride + is;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;

      uvs[idx * 2] = is / segsS;
      uvs[idx * 2 + 1] = t;
    }
  }

  const indices: number[] = [];
  for (let it = 0; it < segsT; it++) {
    for (let is = 0; is < segsS; is++) {
      const v00 = it * stride + is;
      const v10 = v00 + 1;
      const v01 = (it + 1) * stride + is;
      const v11 = v01 + 1;

      indices.push(v00, v01, v10);
      indices.push(v10, v01, v11);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface FiddleLeafFigPlanterOptions {
  readonly namePrefix?: string;
  readonly zone?: string;
  readonly position?: readonly [number, number, number];
}

/**
 * Builds a high-LOD botanical Indoor Fiddle-Leaf Fig Tree (`Ficus lyrata`)
 * in a turned ribbed stoneware floor planter on a 3-legged wooden stand.
 */
export function buildFiddleLeafFigPlanter(
  parent: THREE.Object3D,
  options: FiddleLeafFigPlanterOptions = {}
): THREE.Group {
  const {
    namePrefix = 'fiddleLeafFigPlanter',
    zone,
    position = [0, 0, 0],
  } = options;
  const nwPlantGroup = new THREE.Group();
  nwPlantGroup.name = namePrefix;
  if (zone !== undefined) {
    nwPlantGroup.userData.zone = zone;
  }
  nwPlantGroup.position.set(position[0], position[1], position[2]);

  // Materials
  const stonewarePotMat = new THREE.MeshStandardMaterial({
    color: 0xd8cfc0,
    roughness: 0.5,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const woodStandMat = new THREE.MeshStandardMaterial({
    color: 0x6b4c35,
    roughness: 0.62,
    metalness: 0.04,
  });
  const soilBedMat = new THREE.MeshStandardMaterial({
    color: 0x2c1f16,
    roughness: 0.94,
  });
  const pebbleMat = new THREE.MeshStandardMaterial({
    color: 0x8c8275,
    roughness: 0.72,
  });
  const mossMat = new THREE.MeshStandardMaterial({
    color: 0x3b5929,
    roughness: 0.88,
  });
  const woodyTrunkMat = new THREE.MeshStandardMaterial({
    color: 0x5a4028,
    roughness: 0.78,
  });
  const stipuleScarMat = new THREE.MeshStandardMaterial({
    color: 0x3d2a1a,
    roughness: 0.85,
  });

  // 3 varied botanical green materials for multi-tiered foliage canopy
  const leafDeepEmeraldMat = new THREE.MeshStandardMaterial({
    color: 0x264823, // Deep glossy mature emerald
    roughness: 0.34,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const leafMidGreenMat = new THREE.MeshStandardMaterial({
    color: 0x355e2e, // Vibrant mid-green
    roughness: 0.32,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const leafYoungCrownMat = new THREE.MeshStandardMaterial({
    color: 0x487438, // Fresh young olive-lime at top crown
    roughness: 0.28,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const midribVeinMat = new THREE.MeshStandardMaterial({
    color: 0x6c9652, // Raised pale-green central midrib & petiole
    roughness: 0.42,
    metalness: 0.02,
  });

  // 1. Turned Artisan Ribbed Stoneware Ceramic Planter (`${namePrefix}.pot`)
  // Built with LatheGeometry: height 0.42m, top radius 0.215m, curved belly, tapered base,
  // rolled lip rim, and 18 horizontal turned ribs
  const lathePoints: THREE.Vector2[] = [];
  const potHeight = 0.42;
  const potBaseY = 0.025; // Seated on a low 3-legged wooden plant stand base
  const profileSteps = 72;

  lathePoints.push(new THREE.Vector2(0.0, potBaseY));
  lathePoints.push(new THREE.Vector2(0.148, potBaseY));

  for (let i = 0; i <= profileSteps; i++) {
    const t = i / profileSteps; // 0 = base, 1 = top rim
    const y = potBaseY + t * potHeight;

    // Tapered base -> full curved ceramic belly -> rolled lip rim (top radius 0.215m)
    const bellyCurve = Math.sin(Math.pow(t, 0.75) * Math.PI * 0.88);
    let r = 0.152 + 0.056 * bellyCurve + 0.008 * t;

    // 18 subtle horizontal artisan wheel-turned ribs along the body
    if (t > 0.06 && t < 0.91) {
      r += Math.sin(t * 18 * Math.PI * 2) * 0.0028;
    }

    // Rolled lip rim at top (t > 0.91) reaching radius 0.215m
    if (t >= 0.91) {
      const rimT = (t - 0.91) / 0.09;
      r = 0.203 + Math.sin(rimT * Math.PI) * 0.012;
    }

    lathePoints.push(new THREE.Vector2(r, y));
  }
  // Inner lip wall stepping down to soil level
  lathePoints.push(new THREE.Vector2(0.194, potBaseY + potHeight - 0.004));
  lathePoints.push(new THREE.Vector2(0.188, 0.375));

  const planterGeo = new THREE.LatheGeometry(lathePoints, 36);
  const planterPot = new THREE.Mesh(planterGeo, stonewarePotMat);
  planterPot.name = `${namePrefix}.pot`;
  planterPot.castShadow = true;
  planterPot.receiveShadow = true;
  nwPlantGroup.add(planterPot);

  // Footed 3-legged wooden plant stand cradle under the stoneware pot
  const standRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.155, 0.012, 10, 24),
    woodStandMat
  );
  standRing.name = `${namePrefix}.pot`;
  standRing.rotation.x = Math.PI / 2;
  standRing.position.set(0, 0.024, 0);
  nwPlantGroup.add(standRing);

  for (let legIdx = 0; legIdx < 3; legIdx++) {
    const legAngle = (legIdx * Math.PI * 2) / 3 + 0.4;
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.014, 0.11, 12),
      woodStandMat
    );
    leg.name = `${namePrefix}.pot`;
    leg.position.set(
      Math.cos(legAngle) * 0.168,
      0.058,
      Math.sin(legAngle) * 0.168
    );
    leg.rotation.z = -Math.cos(legAngle) * 0.12;
    leg.rotation.x = Math.sin(legAngle) * 0.12;
    leg.castShadow = true;
    nwPlantGroup.add(leg);
  }

  // Dark organic potting soil disc at y = 0.385m
  const soilDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.192, 0.188, 0.024, 24),
    soilBedMat
  );
  soilDisc.name = `${namePrefix}.soilBed`;
  soilDisc.position.set(0, 0.385, 0);
  soilDisc.receiveShadow = true;
  nwPlantGroup.add(soilDisc);

  // Natural river pebbles and lush moss cushions on the soil surface
  for (const [detailIdx, [px, pz, rx, ry, rz, rotY, isMoss]] of (
    [
      [0.08, 0.09, 0.052, 0.018, 0.044, 0.4, true],
      [-0.1, 0.06, 0.048, 0.016, 0.04, 1.2, true],
      [0.02, -0.11, 0.055, 0.018, 0.042, 2.1, true],
      [0.12, -0.04, 0.022, 0.012, 0.018, 0.8, false],
      [-0.06, 0.12, 0.024, 0.013, 0.019, 1.7, false],
      [-0.11, -0.07, 0.02, 0.011, 0.016, 2.5, false],
      [0.05, 0.13, 0.018, 0.01, 0.015, 0.2, false],
      [-0.02, -0.06, 0.021, 0.012, 0.017, 1.1, false],
    ] as const
  ).entries()) {
    const surfaceDetail = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      isMoss ? mossMat : pebbleMat
    );
    surfaceDetail.name = isMoss
      ? `${namePrefix}.moss.${detailIdx + 1}`
      : `${namePrefix}.pebble.${detailIdx + 1}`;
    if (!isMoss) {
      surfaceDetail.userData.lodTier = 'high';
      surfaceDetail.userData.lodMaxDistance = 12;
    }
    surfaceDetail.scale.set(rx, ry, rz);
    surfaceDetail.position.set(px, 0.396, pz);
    surfaceDetail.rotation.y = rotY;
    nwPlantGroup.add(surfaceDetail);
  }

  // 2. 4 Organically Curved Woody Trunks & Secondary Branches (y = 0.37m..1.28m)
  const trunkDefinitions: ReadonlyArray<{
    readonly points: ReadonlyArray<readonly [number, number, number]>;
    readonly radiusBottom: number;
    readonly radiusTop: number;
  }> = [
    // Main central-tall leader trunk rising to y = 1.28m
    {
      points: [
        [0.0, 0.37, 0.0],
        [0.015, 0.62, 0.02],
        [-0.01, 0.88, 0.035],
        [0.018, 1.12, 0.025],
        [0.01, 1.28, 0.04],
      ],
      radiusBottom: 0.022,
      radiusTop: 0.011,
    },
    // SE front-reaching branch reaching toward hit point [+0.09, 0.98, +0.33]
    {
      points: [
        [0.01, 0.37, 0.01],
        [0.035, 0.56, 0.06],
        [0.065, 0.78, 0.13],
        [0.085, 0.98, 0.18],
        [0.095, 1.14, 0.21],
      ],
      radiusBottom: 0.019,
      radiusTop: 0.0095,
    },
    // SW spreading branch
    {
      points: [
        [-0.015, 0.37, 0.005],
        [-0.045, 0.58, 0.045],
        [-0.085, 0.82, 0.09],
        [-0.11, 1.04, 0.12],
      ],
      radiusBottom: 0.018,
      radiusTop: 0.009,
    },
    // North/East balanced back branch
    {
      points: [
        [0.005, 0.37, -0.015],
        [0.03, 0.55, -0.05],
        [-0.02, 0.76, -0.09],
        [-0.04, 0.98, -0.13],
        [-0.05, 1.15, -0.15],
      ],
      radiusBottom: 0.018,
      radiusTop: 0.009,
    },
  ];

  for (const [trunkIdx, trunkDef] of trunkDefinitions.entries()) {
    const curve = new THREE.CatmullRomCurve3(
      trunkDef.points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
    );
    const radialSegs = 10;
    const tubularSegs = 24;
    const tubeGeo = new THREE.TubeGeometry(
      curve,
      tubularSegs,
      trunkDef.radiusBottom,
      radialSegs,
      false
    );

    // Taper trunk radius naturally from base to crown tip
    const posAttr = tubeGeo.getAttribute('position');
    const centerPt = new THREE.Vector3();
    const vtxPt = new THREE.Vector3();
    for (let i = 0; i <= tubularSegs; i++) {
      const t = i / tubularSegs;
      curve.getPointAt(t, centerPt);
      const scaleR =
        THREE.MathUtils.lerp(trunkDef.radiusBottom, trunkDef.radiusTop, t) /
        trunkDef.radiusBottom;
      for (let j = 0; j <= radialSegs; j++) {
        const idx = i * (radialSegs + 1) + j;
        vtxPt.fromBufferAttribute(posAttr, idx);
        vtxPt.sub(centerPt).multiplyScalar(scaleR).add(centerPt);
        posAttr.setXYZ(idx, vtxPt.x, vtxPt.y, vtxPt.z);
      }
    }
    tubeGeo.computeVertexNormals();
    tubeGeo.computeBoundingSphere();

    const trunkMesh = new THREE.Mesh(tubeGeo, woodyTrunkMat);
    trunkMesh.name = `${namePrefix}.trunk.${trunkIdx + 1}`;
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    nwPlantGroup.add(trunkMesh);

    // Brown papery stipule leaf-scar rings along the woody trunk nodes
    for (const [scarIdx, nodeT] of ([0.22, 0.44, 0.66, 0.86] as const).entries()) {
      const nodePos = curve.getPointAt(nodeT);
      const nodeTangent = curve.getTangentAt(nodeT);
      const nodeR = THREE.MathUtils.lerp(
        trunkDef.radiusBottom,
        trunkDef.radiusTop,
        nodeT
      );
      const scarRing = new THREE.Mesh(
        new THREE.TorusGeometry(nodeR * 1.06, 0.0025, 6, 14),
        stipuleScarMat
      );
      scarRing.name = `${namePrefix}.trunk.${trunkIdx + 1}.stipuleScar.${scarIdx + 1}`;
      scarRing.userData.lodTier = 'high';
      scarRing.userData.lodMaxDistance = 12;
      scarRing.position.copy(nodePos);
      scarRing.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        nodeTangent.normalize()
      );
      nwPlantGroup.add(scarRing);
    }
  }

  // 3. 25 High-LOD Sculpted Fiddle-Leaf Fig Leaves (`${namePrefix}.leaf`)
  // Arranged in a lush, multi-tiered radial botanical canopy from y = 0.55m to y = 1.52m
  const leafTemplates = [
    // Large mature lower/mid leaves
    createFiddleLeafGeometry(0.34, 0.22, 0.065, 0.028),
    // Medium-large sculptural mid-canopy leaves
    createFiddleLeafGeometry(0.3, 0.195, 0.052, 0.025),
    // Upright fresh young crown leaves
    createFiddleLeafGeometry(0.25, 0.165, 0.036, 0.022),
  ] as const;

  interface LeafPlacement {
    readonly stemX: number;
    readonly stemY: number;
    readonly stemZ: number;
    readonly yawY: number;
    readonly pitchX: number;
    readonly rollZ: number;
    readonly sizeTier: 0 | 1 | 2; // 0 = mature large, 1 = mid, 2 = young crown
    readonly matTier: 0 | 1 | 2; // 0 = deep emerald, 1 = mid green, 2 = young olive-lime
  }

  const leafPlacements: readonly LeafPlacement[] = [
    // Top Apical Crown Tier (y = 1.24m..1.46m, reaching up to y = 1.52m)
    { stemX: 0.01, stemY: 1.28, stemZ: 0.04, yawY: 0.15, pitchX: -0.52, rollZ: 0.04, sizeTier: 2, matTier: 2 },
    { stemX: 0.015, stemY: 1.26, stemZ: 0.035, yawY: 2.15, pitchX: -0.48, rollZ: -0.05, sizeTier: 2, matTier: 2 },
    { stemX: 0.005, stemY: 1.25, stemZ: 0.03, yawY: -1.85, pitchX: -0.46, rollZ: 0.06, sizeTier: 2, matTier: 2 },
    { stemX: 0.09, stemY: 1.14, stemZ: 0.2, yawY: 0.35, pitchX: -0.36, rollZ: -0.08, sizeTier: 2, matTier: 2 },
    { stemX: -0.05, stemY: 1.15, stemZ: -0.14, yawY: 3.05, pitchX: -0.38, rollZ: 0.05, sizeTier: 2, matTier: 2 },

    // Upper-Mid Canopy Tier (y = 0.98m..1.18m — directly covers hit point [+0.089, +0.982, +0.328])
    { stemX: 0.08, stemY: 1.0, stemZ: 0.16, yawY: 0.22, pitchX: -0.12, rollZ: 0.04, sizeTier: 0, matTier: 1 },
    { stemX: 0.07, stemY: 1.06, stemZ: 0.15, yawY: 0.85, pitchX: -0.22, rollZ: -0.1, sizeTier: 1, matTier: 1 },
    { stemX: 0.04, stemY: 1.08, stemZ: 0.08, yawY: -0.55, pitchX: -0.24, rollZ: 0.08, sizeTier: 1, matTier: 2 },
    { stemX: -0.1, stemY: 1.04, stemZ: 0.11, yawY: -0.95, pitchX: -0.18, rollZ: 0.12, sizeTier: 1, matTier: 1 },
    { stemX: -0.09, stemY: 1.02, stemZ: 0.09, yawY: -1.65, pitchX: -0.15, rollZ: -0.08, sizeTier: 0, matTier: 0 },
    { stemX: 0.02, stemY: 1.1, stemZ: 0.02, yawY: 1.52, pitchX: -0.26, rollZ: -0.06, sizeTier: 1, matTier: 1 },
    { stemX: -0.03, stemY: 1.02, stemZ: -0.11, yawY: 2.55, pitchX: -0.2, rollZ: 0.09, sizeTier: 1, matTier: 0 },
    { stemX: -0.04, stemY: 0.98, stemZ: -0.12, yawY: -2.45, pitchX: -0.16, rollZ: -0.07, sizeTier: 0, matTier: 1 },

    // Mid-Body Lush Tier (y = 0.76m..0.94m)
    { stemX: 0.06, stemY: 0.88, stemZ: 0.12, yawY: 0.08, pitchX: 0.04, rollZ: 0.05, sizeTier: 0, matTier: 0 },
    { stemX: 0.065, stemY: 0.84, stemZ: 0.11, yawY: 1.18, pitchX: 0.02, rollZ: -0.11, sizeTier: 0, matTier: 1 },
    { stemX: -0.07, stemY: 0.86, stemZ: 0.08, yawY: -0.68, pitchX: 0.05, rollZ: 0.09, sizeTier: 0, matTier: 0 },
    { stemX: -0.08, stemY: 0.8, stemZ: 0.06, yawY: -1.42, pitchX: 0.08, rollZ: 0.12, sizeTier: 0, matTier: 1 },
    { stemX: 0.03, stemY: 0.82, stemZ: -0.06, yawY: 2.05, pitchX: 0.04, rollZ: -0.08, sizeTier: 0, matTier: 0 },
    { stemX: -0.03, stemY: 0.78, stemZ: -0.08, yawY: -2.75, pitchX: 0.06, rollZ: 0.07, sizeTier: 0, matTier: 0 },
    { stemX: 0.01, stemY: 0.9, stemZ: 0.03, yawY: -2.1, pitchX: -0.05, rollZ: -0.06, sizeTier: 1, matTier: 1 },

    // Lower Skirt Tier above Planter Rim (y = 0.55m..0.72m)
    { stemX: 0.04, stemY: 0.66, stemZ: 0.07, yawY: 0.48, pitchX: 0.18, rollZ: -0.06, sizeTier: 0, matTier: 0 },
    { stemX: -0.04, stemY: 0.64, stemZ: 0.05, yawY: -0.42, pitchX: 0.2, rollZ: 0.08, sizeTier: 0, matTier: 0 },
    { stemX: 0.05, stemY: 0.62, stemZ: -0.03, yawY: 1.68, pitchX: 0.16, rollZ: -0.09, sizeTier: 1, matTier: 0 },
    { stemX: -0.05, stemY: 0.6, stemZ: -0.04, yawY: -1.78, pitchX: 0.18, rollZ: 0.09, sizeTier: 1, matTier: 0 },
    { stemX: 0.0, stemY: 0.58, stemZ: -0.06, yawY: 3.1, pitchX: 0.22, rollZ: 0.03, sizeTier: 1, matTier: 0 },
  ];

  const leafMaterials = [
    leafDeepEmeraldMat,
    leafMidGreenMat,
    leafYoungCrownMat,
  ] as const;
  const leafDimensions = [
    { length: 0.34, archDrop: 0.065 },
    { length: 0.3, archDrop: 0.052 },
    { length: 0.25, archDrop: 0.036 },
  ] as const;

  for (const [leafIdx, spec] of leafPlacements.entries()) {
    const leafPivot = new THREE.Group();
    leafPivot.name = `${namePrefix}.leafGroup.${leafIdx + 1}`;
    leafPivot.position.set(spec.stemX, spec.stemY, spec.stemZ);
    leafPivot.rotation.order = 'YXZ';
    leafPivot.rotation.set(spec.pitchX, spec.yawY, spec.rollZ);

    const petioleLen = 0.055;
    const { length: bladeLen, archDrop } = leafDimensions[spec.sizeTier];

    // Tapered green petiole stem + raised pale-green central midrib vein running down the spine
    const spinePoints = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.004, petioleLen),
      new THREE.Vector3(
        0,
        (0.22 * 0.45 - 0.45 * 0.45) * archDrop + 0.002,
        petioleLen + bladeLen * 0.45
      ),
      new THREE.Vector3(
        0,
        (0.22 * 0.92 - 0.92 * 0.92) * archDrop + 0.001,
        petioleLen + bladeLen * 0.92
      ),
    ];
    const spineCurve = new THREE.CatmullRomCurve3(spinePoints);
    const midribGeo = new THREE.TubeGeometry(spineCurve, 14, 0.0042, 6, false);
    const midribMesh = new THREE.Mesh(midribGeo, midribVeinMat);
    midribMesh.name = `${namePrefix}.leaf`;
    midribMesh.castShadow = true;
    leafPivot.add(midribMesh);

    // Sculpted violin-shaped Fiddle-Leaf blade attached at the end of the petiole
    const leafBlade = new THREE.Mesh(
      leafTemplates[spec.sizeTier],
      leafMaterials[spec.matTier]
    );
    leafBlade.name = `${namePrefix}.leaf`;
    leafBlade.position.set(0, 0.003, petioleLen);
    leafBlade.castShadow = true;
    leafBlade.receiveShadow = true;
    leafPivot.add(leafBlade);

    nwPlantGroup.add(leafPivot);
  }

  parent.add(nwPlantGroup);
  return nwPlantGroup;
}

