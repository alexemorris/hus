import * as THREE from 'three';

export interface TraditionalWindowCurtainsOptions {
  readonly groupName: string;
  readonly poleName: string;
  readonly finialName: string;
  readonly bracketName: string;
  readonly panelName: string;
  readonly headerName: string;
  readonly hemName: string;
  readonly tieBackName: string;
  readonly halfWindowSpanZ: number;
  readonly poleExtensionZ: number;
  readonly stackWidthZ: number;
  readonly stackInnerInsetZ: number;
  readonly poleX: number;
  readonly wallFaceX: number;
  readonly poleY: number;
  readonly floorY: number;
  readonly tieBackY: number;
  readonly centerZ: number;
  readonly inwardSignX: 1 | -1; // +1 when curtains project +X into room (West bay windows), -1 when curtains project -X into room (East window)
  readonly mainColorHex: number;
  readonly shadowColorHex: number;
  readonly trimColorHex: number;
  readonly brassMat: THREE.Material;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

interface DraperySurfaceEval {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly shade: number; // 0 = deep valley shadow, 1 = bright front crest
}

/**
 * Evaluates a point on a traditional English country-house triple-pinch-pleat
 * interlined curtain panel for `u in [0, 1]` (0 = inner leading edge toward window
 * center, 1 = outer wall pier edge) and `v in [0, 1]` (0 = top buckram heading
 * under pole, 1 = weighted bottom hem kissing the floor).
 */
function evaluateCurtainSurfacePoint(
  u: number,
  v: number,
  sideZ: -1 | 1,
  options: TraditionalWindowCurtainsOptions,
  curtainTopY: number,
  curtainBotY: number
): DraperySurfaceEval {
  const {
    halfWindowSpanZ,
    poleExtensionZ,
    stackWidthZ,
    stackInnerInsetZ,
    poleX,
    tieBackY,
    centerZ,
    inwardSignX,
  } = options;

  const curtainH = curtainTopY - curtainBotY;
  const vTie = THREE.MathUtils.clamp(
    (curtainTopY - tieBackY) / curtainH,
    0.48,
    0.76
  );

  // Outer edge hangs nearly straight along the outer wall pier, cinching slightly at the tie-back hook
  const baseOuterOffZ = Math.max(
    halfWindowSpanZ + poleExtensionZ - 0.06,
    halfWindowSpanZ - stackInnerInsetZ + stackWidthZ
  );
  const waistGauss = Math.exp(-Math.pow((v - vTie) / 0.14, 2));
  const outerOffZ = baseOuterOffZ - 0.018 * waistGauss;

  // Inner leading edge: starts fuller toward the window at top pole, sweeps outward in a smooth
  // traditional catenary curve down to the tie-back waist, then billows/flares softly toward the floor
  const innerTopOffZ = Math.max(
    0.16,
    halfWindowSpanZ - stackInnerInsetZ - 0.14
  );
  const innerTieOffZ = halfWindowSpanZ - stackInnerInsetZ + 0.08;
  const innerBotOffZ = halfWindowSpanZ - stackInnerInsetZ + 0.01;

  let innerOffZ: number;
  if (v <= 0.055) {
    innerOffZ = innerTopOffZ;
  } else if (v <= vTie) {
    const tSweep = (v - 0.055) / (vTie - 0.055);
    // Classic catenary-like sweep: vertical near the buckram header, curving gracefully into the tie-back loop
    const catenaryBlend =
      0.55 * Math.pow(tSweep, 1.45) + 0.45 * smoothstep(0, 1, tSweep);
    innerOffZ = THREE.MathUtils.lerp(innerTopOffZ, innerTieOffZ, catenaryBlend);
  } else {
    const tSkirt = (v - vTie) / (1 - vTie);
    // Soft bell flare below the tie-back down to the floor hem
    const skirtFlare = Math.sin(tSkirt * (Math.PI * 0.5));
    innerOffZ = THREE.MathUtils.lerp(innerTieOffZ, innerBotOffZ, skirtFlare);
  }

  const foldCount = 8;
  const phase = u * foldCount * Math.PI * 2;

  // Omega-pleat lateral rounding so each drapery flute has bulbous 3D fullness in Z as well as X
  const omegaZ =
    Math.sin(phase) *
    0.0085 *
    (0.65 + 0.35 * v) *
    (1 - 0.35 * waistGauss) *
    Math.sin(u * Math.PI);

  const spanOffZ = THREE.MathUtils.lerp(innerOffZ, outerOffZ, u) + omegaZ;
  const z = centerZ + sideZ * spanOffZ;

  // Vertical coordinate with subtle organic floor kiss wave along the bottom hem
  const bottomWaveY =
    smoothstep(0.88, 1.0, v) * 0.0035 * Math.cos(phase);
  const y = curtainTopY - v * curtainH + bottomWaveY;

  // --- X Depth Profile (Triple-Pinch-Pleat Heading + Soft Rounded Flutes + Tie-Back Waist Cinch) ---
  // 1. Top Triple-Pinch-Pleat (French Pleat) Buckram Heading (v = 0..0.085)
  const headingZone = 1 - smoothstep(0.035, 0.095, v);
  const pinchClasp = Math.exp(-Math.pow((v - 0.042) / 0.02, 2));
  const pleatCrestEnvelope = Math.pow(0.5 + 0.5 * Math.cos(phase), 1.4);
  // 3-finger fan sub-pleats at each French pleat crown, pinched tightly at v = 0.042
  const tripleFingerWave =
    Math.cos(phase * 3) * pleatCrestEnvelope * (1 - 0.55 * pinchClasp);

  // 2. Main Soft Rounded Drapery Flutes (primary wave + fullness harmonics)
  const primaryFlute = Math.cos(phase);
  const secondaryFullness =
    0.26 * Math.cos(phase * 2) - 0.07 * Math.cos(phase * 3);
  const mainFluteWave = primaryFlute + secondaryFullness;

  // Vertical envelope of fold amplitude:
  // Neat at buckram heading -> deep in body -> compressed ~30% at tie-back waist -> flared +35% at bottom hem
  const bodyGrowth = THREE.MathUtils.lerp(0.026, 0.044, smoothstep(0.0, 0.3, v));
  const skirtFlareAmp = smoothstep(vTie, 1.0, v) * 0.016;
  const waistCompression = 1 - 0.32 * waistGauss;
  const foldAmplitude = (bodyGrowth + skirtFlareAmp) * waistCompression;

  // 3. Diagonal tension folds sweeping from the upper/inner leading edge into the tie-back waist cinch
  const diagPhase = (u * 4.5 + (v - vTie) * 3.8) * Math.PI;
  const diagCrease =
    Math.sin(diagPhase) *
    Math.exp(-Math.pow((v - vTie) / 0.26, 2)) *
    Math.sin(u * Math.PI) *
    0.011;

  // 4. Overall X projection from pole line:
  // Pulled ~1.8cm closer to the wall at the tie-back waist, billowing softly forward below the tie-back
  const waistPullBackX = -0.018 * waistGauss * (0.45 + 0.55 * u);
  const lowerBillowX =
    v > vTie
      ? Math.sin(((v - vTie) / (1 - vTie)) * Math.PI * 0.82) * 0.015
      : Math.sin((v / vTie) * Math.PI) * 0.006;
  // Leading inner cascade edge drapes slightly proud into the room
  const leadingEdgeCascadeX = (1 - u) * 0.012 * Math.sin(v * Math.PI * 0.9);

  const combinedWaveX =
    THREE.MathUtils.lerp(
      mainFluteWave * foldAmplitude,
      (primaryFlute * 0.022 + tripleFingerWave * 0.0095) * (1 - 0.2 * pinchClasp),
      headingZone
    ) + diagCrease;

  const x =
    poleX +
    inwardSignX *
      (0.006 + waistPullBackX + lowerBillowX + leadingEdgeCascadeX + combinedWaveX);

  // Normalized self-shadowing factor (0 in deep recessed valleys & tie-back crease, 1 on front crests)
  const rawShade =
    0.52 +
    0.38 * primaryFlute +
    0.1 * Math.cos(phase * 2) -
    0.12 * waistGauss +
    0.08 * headingZone * Math.cos(phase * 3);
  const shade = THREE.MathUtils.clamp(rawShade, 0, 1);

  return { x, y, z, shade };
}

/**
 * Builds a closed, double-sided sculpted 3D curtain panel BufferGeometry with
 * interlined thickness (~0.035m) and vertex colors for warm fold self-shadowing.
 */
function createSculptedCurtainPanelGeometry(
  sideZ: -1 | 1,
  options: TraditionalWindowCurtainsOptions,
  curtainTopY: number,
  curtainBotY: number
): THREE.BufferGeometry {
  const cols = 28;
  const rows = 26;
  const stride = cols + 1;
  const gridVertexCount = (cols + 1) * (rows + 1);
  const totalVertices = gridVertexCount * 2;

  const positions = new Float32Array(totalVertices * 3);
  const colors = new Float32Array(totalVertices * 3);
  const uvs = new Float32Array(totalVertices * 2);

  const mainCol = new THREE.Color(options.mainColorHex);
  const shadowCol = new THREE.Color(options.shadowColorHex);
  const tempCol = new THREE.Color();

  // Because material.color is set to mainColorHex, normalize vertex colors relative to mainCol
  // so that vertexColor * material.color reproduces exact shadowColorHex..mainColorHex tones.
  const baseR = Math.max(0.05, mainCol.r);
  const baseG = Math.max(0.05, mainCol.g);
  const baseB = Math.max(0.05, mainCol.b);

  const liningThickness = 0.035;
  const inwardX = options.inwardSignX;

  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const evalPt = evaluateCurtainSurfacePoint(
        u,
        v,
        sideZ,
        options,
        curtainTopY,
        curtainBotY
      );

      const frontIdx = r * stride + c;
      const backIdx = gridVertexCount + frontIdx;

      // Front drapery face
      positions[frontIdx * 3] = evalPt.x;
      positions[frontIdx * 3 + 1] = evalPt.y;
      positions[frontIdx * 3 + 2] = evalPt.z;

      // Back interlined lining face (offset toward wall by liningThickness)
      const edgeTaper =
        Math.sin(u * Math.PI) * (0.75 + 0.25 * Math.sin(v * Math.PI));
      const thicknessHere = liningThickness * (0.55 + 0.45 * edgeTaper);
      positions[backIdx * 3] = evalPt.x - inwardX * thicknessHere;
      positions[backIdx * 3 + 1] = evalPt.y;
      positions[backIdx * 3 + 2] = evalPt.z;

      uvs[frontIdx * 2] = u;
      uvs[frontIdx * 2 + 1] = 1 - v;
      uvs[backIdx * 2] = u;
      uvs[backIdx * 2 + 1] = 1 - v;

      tempCol.lerpColors(shadowCol, mainCol, evalPt.shade);
      colors[frontIdx * 3] = THREE.MathUtils.clamp(tempCol.r / baseR, 0, 1.08);
      colors[frontIdx * 3 + 1] = THREE.MathUtils.clamp(
        tempCol.g / baseG,
        0,
        1.08
      );
      colors[frontIdx * 3 + 2] = THREE.MathUtils.clamp(
        tempCol.b / baseB,
        0,
        1.08
      );

      // Back lining is slightly warmer/shaded
      tempCol.lerpColors(shadowCol, mainCol, evalPt.shade * 0.72);
      colors[backIdx * 3] = THREE.MathUtils.clamp(tempCol.r / baseR, 0, 1.0);
      colors[backIdx * 3 + 1] = THREE.MathUtils.clamp(tempCol.g / baseG, 0, 1.0);
      colors[backIdx * 3 + 2] = THREE.MathUtils.clamp(tempCol.b / baseB, 0, 1.0);
    }
  }

  const indices: number[] = [];
  const flipWinding = inwardX * sideZ < 0;

  const pushTri = (a: number, b: number, c: number): void => {
    if (flipWinding) {
      indices.push(a, c, b);
    } else {
      indices.push(a, b, c);
    }
  };

  // Front and back faces
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const f00 = r * stride + c;
      const f10 = f00 + 1;
      const f01 = (r + 1) * stride + c;
      const f11 = f01 + 1;

      pushTri(f00, f01, f10);
      pushTri(f10, f01, f11);

      const b00 = gridVertexCount + f00;
      const b10 = gridVertexCount + f10;
      const b01 = gridVertexCount + f01;
      const b11 = gridVertexCount + f11;

      pushTri(b00, b10, b01);
      pushTri(b10, b11, b01);
    }
  }

  // Stitch inner leading edge (c = 0) and outer edge (c = cols)
  for (let r = 0; r < rows; r++) {
    const fLead0 = r * stride;
    const fLead1 = (r + 1) * stride;
    const bLead0 = gridVertexCount + fLead0;
    const bLead1 = gridVertexCount + fLead1;
    pushTri(fLead0, bLead0, fLead1);
    pushTri(bLead0, bLead1, fLead1);

    const fOut0 = r * stride + cols;
    const fOut1 = (r + 1) * stride + cols;
    const bOut0 = gridVertexCount + fOut0;
    const bOut1 = gridVertexCount + fOut1;
    pushTri(fOut0, fOut1, bOut0);
    pushTri(bOut0, fOut1, bOut1);
  }

  // Stitch top buckram crown edge (r = 0) and bottom hem edge (r = rows)
  for (let c = 0; c < cols; c++) {
    const fTop0 = c;
    const fTop1 = c + 1;
    const bTop0 = gridVertexCount + fTop0;
    const bTop1 = gridVertexCount + fTop1;
    pushTri(fTop0, fTop1, bTop0);
    pushTri(bTop0, fTop1, bTop1);

    const fBot0 = rows * stride + c;
    const fBot1 = rows * stride + c + 1;
    const bBot0 = gridVertexCount + fBot0;
    const bBot1 = gridVertexCount + fBot1;
    pushTri(fBot0, bBot0, fBot1);
    pushTri(bBot0, bBot1, fBot1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Builds a tailored serpentine band geometry (used for the buckram header detail
 * at `v = 0.035` and the weighted double-turned bottom hem border at `v = 0.985`)
 * that conforms tightly to the sinusoidal folds of the curtain panel.
 */
function createConformingBandGeometry(
  vCenter: number,
  bandHeight: number,
  protrusionX: number,
  sideZ: -1 | 1,
  options: TraditionalWindowCurtainsOptions,
  curtainTopY: number,
  curtainBotY: number
): THREE.BufferGeometry {
  const stepsU = 28;
  const curvePts: THREE.Vector3[] = [];
  for (let i = 0; i <= stepsU; i++) {
    const u = i / stepsU;
    const pt = evaluateCurtainSurfacePoint(
      u,
      vCenter,
      sideZ,
      options,
      curtainTopY,
      curtainBotY
    );
    curvePts.push(
      new THREE.Vector3(
        pt.x + options.inwardSignX * protrusionX,
        pt.y,
        pt.z
      )
    );
  }
  const path = new THREE.CatmullRomCurve3(curvePts);
  const tubeGeo = new THREE.TubeGeometry(path, 28, bandHeight * 0.5, 8, false);
  tubeGeo.computeBoundingSphere();
  return tubeGeo;
}

/**
 * Issue #2: Builds traditional English country-house triple-pinch-pleat interlined
 * drapery panels that sweep in a graceful catenary curve into a sculpted fabric
 * tie-back sash and flare softly down to the floor, complete with a 38mm aged-brass
 * curtain pole, turned ball finials, wall brackets, and curtain rings.
 */
export function buildTraditionalWindowCurtains(
  options: TraditionalWindowCurtainsOptions
): THREE.Group {
  const {
    groupName,
    poleName,
    finialName,
    bracketName,
    panelName,
    headerName,
    hemName,
    tieBackName,
    halfWindowSpanZ,
    poleExtensionZ,
    poleX,
    wallFaceX,
    poleY,
    floorY,
    tieBackY,
    centerZ,
    inwardSignX,
    mainColorHex,
    trimColorHex,
    brassMat,
  } = options;

  const curtainGroup = new THREE.Group();
  curtainGroup.name = groupName;

  const panelMat = new THREE.MeshStandardMaterial({
    color: mainColorHex,
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.01,
    side: THREE.DoubleSide,
  });

  const headerMat = new THREE.MeshStandardMaterial({
    color: mainColorHex,
    roughness: 0.84,
    metalness: 0.01,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: trimColorHex,
    roughness: 0.8,
    metalness: 0.02,
  });

  // 1. 38mm (r = 0.019m) straight aged-brass curtain pole
  const poleHalfLenZ = halfWindowSpanZ + poleExtensionZ;
  const poleLenZ = poleHalfLenZ * 2;
  const straightPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.019, 0.019, poleLenZ, 20),
    brassMat
  );
  straightPole.name = poleName;
  straightPole.rotation.x = Math.PI / 2;
  straightPole.position.set(poleX, poleY, centerZ);
  straightPole.castShadow = true;
  straightPole.receiveShadow = true;
  curtainGroup.add(straightPole);

  // 2. Turned brass ball finials & decorative collar rings at both ends
  for (const dirZ of [-1, 1] as const) {
    const endZ = centerZ + dirZ * poleHalfLenZ;

    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.018, 18),
      brassMat
    );
    collar.name = finialName;
    collar.rotation.x = Math.PI / 2;
    collar.position.set(poleX, poleY, endZ - dirZ * 0.008);
    collar.castShadow = true;
    curtainGroup.add(collar);

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.021, 0.016, 16),
      brassMat
    );
    neck.name = finialName;
    neck.rotation.x = Math.PI / 2;
    neck.position.set(poleX, poleY, endZ + dirZ * 0.006);
    curtainGroup.add(neck);

    const finialBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 20, 18),
      brassMat
    );
    finialBall.name = finialName;
    finialBall.position.set(poleX, poleY, endZ + dirZ * 0.032);
    finialBall.castShadow = true;
    curtainGroup.add(finialBall);

    const finialNipple = new THREE.Mesh(
      new THREE.SphereGeometry(0.011, 12, 12),
      brassMat
    );
    finialNipple.name = finialName;
    finialNipple.position.set(poleX, poleY, endZ + dirZ * 0.068);
    curtainGroup.add(finialNipple);
  }

  // 3. 3 heavy wall support brackets & circular backplates projecting from wallFaceX to poleX
  const bracketOffsetZ = halfWindowSpanZ + Math.max(0.2, poleExtensionZ - 0.1);
  const bracketSpanX = Math.max(0.02, Math.abs(poleX - wallFaceX));
  const bracketMidX = (wallFaceX + poleX) * 0.5;

  for (const bZ of [
    centerZ - bracketOffsetZ,
    centerZ,
    centerZ + bracketOffsetZ,
  ] as const) {
    const bracketStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.012, bracketSpanX, 14),
      brassMat
    );
    bracketStem.name = bracketName;
    bracketStem.rotation.z = Math.PI / 2;
    bracketStem.position.set(bracketMidX, poleY, bZ);
    bracketStem.castShadow = true;
    curtainGroup.add(bracketStem);

    const backplate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.008, 16),
      brassMat
    );
    backplate.name = bracketName;
    backplate.rotation.z = Math.PI / 2;
    backplate.position.set(wallFaceX + inwardSignX * 0.004, poleY, bZ);
    curtainGroup.add(backplate);

    const poleCradle = new THREE.Mesh(
      new THREE.TorusGeometry(0.021, 0.0045, 10, 16, Math.PI),
      brassMat
    );
    poleCradle.name = bracketName;
    poleCradle.rotation.y = Math.PI / 2;
    poleCradle.rotation.x = Math.PI;
    poleCradle.position.set(poleX, poleY - 0.002, bZ);
    curtainGroup.add(poleCradle);
  }

  // 4. North (sideZ = -1) and South (sideZ = +1) Traditional Triple-Pinch-Pleat Drapery Panels
  const curtainTopY = poleY - 0.018;
  const curtainBotY = floorY + 0.01;
  const curtainH = curtainTopY - curtainBotY;
  const vTie = THREE.MathUtils.clamp(
    (curtainTopY - tieBackY) / curtainH,
    0.48,
    0.76
  );

  for (const sideZ of [-1, 1] as const) {
    // Sculpted continuous 3D draped curtain panel mesh
    const panelGeo = createSculptedCurtainPanelGeometry(
      sideZ,
      options,
      curtainTopY,
      curtainBotY
    );
    const panelMesh = new THREE.Mesh(panelGeo, panelMat);
    panelMesh.name = panelName;
    panelMesh.castShadow = true;
    panelMesh.receiveShadow = true;
    curtainGroup.add(panelMesh);

    // 8 Triple-Pinch-Pleat (French Pleat) 3-finger fan clasps + brass curtain rings along the pole
    const foldCount = 8;
    for (let p = 0; p <= foldCount; p++) {
      const uPleat = p / foldCount;
      const topPt = evaluateCurtainSurfacePoint(
        uPleat,
        0.038,
        sideZ,
        options,
        curtainTopY,
        curtainBotY
      );

      // 3-finger pinched fan clasp at each pleat crest
      for (const fingerIdx of [-1, 0, 1] as const) {
        const finger = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0065, 0.0045, 0.078, 10),
          headerMat
        );
        finger.name = headerName;
        finger.position.set(
          topPt.x + inwardSignX * (0.005 - Math.abs(fingerIdx) * 0.002),
          curtainTopY - 0.042,
          topPt.z + sideZ * fingerIdx * 0.0075
        );
        finger.rotation.x = sideZ * fingerIdx * 0.14;
        finger.castShadow = true;
        curtainGroup.add(finger);
      }

      // Tailored pinch tacking stitch wrap at the waist of each triple pleat
      const pinchTack = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.011, 0.016, 12),
        trimMat
      );
      pinchTack.name = headerName;
      pinchTack.position.set(
        topPt.x + inwardSignX * 0.004,
        curtainTopY - 0.068,
        topPt.z
      );
      curtainGroup.add(pinchTack);

      // Brass curtain ring on the pole above each triple-pinch-pleat
      const sideLabel = sideZ < 0 ? 'north' : 'south';
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.028, 0.0048, 10, 18),
        brassMat
      );
      ring.name = `${poleName}.ring.${sideLabel}.${p + 1}`;
      ring.rotation.y = Math.PI / 2;
      ring.position.set(poleX, poleY, topPt.z);
      ring.castShadow = true;
      curtainGroup.add(ring);

      // Small brass eyelet connecting ring bottom to the pleat header
      const eyelet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.003, 0.003, 0.016, 8),
        brassMat
      );
      eyelet.name = `${poleName}.eyelet.${sideLabel}.${p + 1}`;
      eyelet.userData.lodTier = 'high';
      eyelet.userData.lodMaxDistance = 12;
      eyelet.position.set(poleX, poleY - 0.028, topPt.z);
      curtainGroup.add(eyelet);
    }

    // Weighted bottom hem double-fold border following the flared bottom contour (hemName)
    const bottomHemGeo = createConformingBandGeometry(
      0.985,
      0.036,
      0.005,
      sideZ,
      options,
      curtainTopY,
      curtainBotY
    );
    const bottomHem = new THREE.Mesh(bottomHemGeo, trimMat);
    bottomHem.name = hemName;
    bottomHem.castShadow = true;
    bottomHem.receiveShadow = true;
    curtainGroup.add(bottomHem);

    // Sculpted Traditional Curved Tie-Back Sash & Brass Hook (tieBackName)
    // Wraps snugly around the cinched waist at v = vTie and angles ~12 deg upward to the outer wall pier hook
    const innerWaistPt = evaluateCurtainSurfacePoint(
      0.0,
      vTie,
      sideZ,
      options,
      curtainTopY,
      curtainBotY
    );
    const midFrontWaistPt = evaluateCurtainSurfacePoint(
      0.48,
      vTie,
      sideZ,
      options,
      curtainTopY,
      curtainBotY
    );
    const outerWaistPt = evaluateCurtainSurfacePoint(
      1.0,
      vTie,
      sideZ,
      options,
      curtainTopY,
      curtainBotY
    );

    const hookZ = outerWaistPt.z + sideZ * 0.035;
    const hookSpanZ = Math.abs(hookZ - innerWaistPt.z);
    // ~12 degrees upward angle from inner waist loop to outer wall hook
    const hookRiseY = Math.tan((12 * Math.PI) / 180) * hookSpanZ;
    const hookY = tieBackY + hookRiseY;
    const hookX = wallFaceX + inwardSignX * 0.022;

    const sashPoints: THREE.Vector3[] = [
      // From wall hook around the front of the curtain panel
      new THREE.Vector3(hookX, hookY, hookZ),
      new THREE.Vector3(
        outerWaistPt.x + inwardSignX * 0.032,
        tieBackY + hookRiseY * 0.55,
        outerWaistPt.z
      ),
      new THREE.Vector3(
        midFrontWaistPt.x + inwardSignX * 0.042,
        tieBackY + hookRiseY * 0.2,
        midFrontWaistPt.z
      ),
      // Snug U-turn loop around the inner leading waist edge
      new THREE.Vector3(
        innerWaistPt.x + inwardSignX * 0.015,
        tieBackY,
        innerWaistPt.z - sideZ * 0.018
      ),
      // Returning behind the curtain panel back to the brass wall hook (clamped >= 4mm proud of wallFaceX)
      new THREE.Vector3(
        wallFaceX + inwardSignX * Math.max(0.004, (midFrontWaistPt.x - inwardSignX * 0.048 - wallFaceX) * inwardSignX),
        tieBackY + hookRiseY * 0.22,
        midFrontWaistPt.z
      ),
      new THREE.Vector3(
        wallFaceX + inwardSignX * Math.max(0.004, (outerWaistPt.x - inwardSignX * 0.036 - wallFaceX) * inwardSignX),
        tieBackY + hookRiseY * 0.6,
        outerWaistPt.z
      ),
      new THREE.Vector3(hookX, hookY, hookZ),
    ];

    const sashCurve = new THREE.CatmullRomCurve3(sashPoints, false);
    const sashGeo = new THREE.TubeGeometry(sashCurve, 44, 0.018, 12, false);
    // Scale Y around tieBackY so the tie-back reads as a wide tailored crescent band (~6.3cm tall) without vertical drift
    sashGeo.translate(0, -tieBackY, 0);
    sashGeo.scale(1, 1.75, 1);
    sashGeo.translate(0, tieBackY, 0);
    sashGeo.computeBoundingSphere();

    const tieBackSash = new THREE.Mesh(sashGeo, trimMat);
    tieBackSash.name = tieBackName;
    tieBackSash.castShadow = true;
    tieBackSash.receiveShadow = true;
    curtainGroup.add(tieBackSash);

    // Upper and lower contrast piping welts along the crescent tie-back sash
    for (const weltOffsetY of [-0.026, 0.026] as const) {
      const weltGeo = new THREE.TubeGeometry(sashCurve, 36, 0.0045, 8, false);
      const weltMesh = new THREE.Mesh(weltGeo, headerMat);
      weltMesh.name = tieBackName;
      weltMesh.position.y = weltOffsetY;
      curtainGroup.add(weltMesh);
    }

    // Turned aged-brass tie-back wall hook & rosette on the outer pier
    const hookRosette = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.008, 16),
      brassMat
    );
    hookRosette.name = tieBackName;
    hookRosette.rotation.z = Math.PI / 2;
    hookRosette.position.set(wallFaceX + inwardSignX * 0.004, hookY, hookZ);
    curtainGroup.add(hookRosette);

    const hookStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.009, 0.032, 12),
      brassMat
    );
    hookStem.name = tieBackName;
    hookStem.rotation.z = Math.PI / 2;
    hookStem.position.set(wallFaceX + inwardSignX * 0.018, hookY, hookZ);
    curtainGroup.add(hookStem);

    const hookBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 14, 14),
      brassMat
    );
    hookBall.name = tieBackName;
    hookBall.position.set(wallFaceX + inwardSignX * 0.036, hookY, hookZ);
    hookBall.castShadow = true;
    curtainGroup.add(hookBall);

    // Brass ring loop at the tip of the fabric sash hooking onto the brass wall knob
    const sashBrassRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.016, 0.0035, 8, 16),
      brassMat
    );
    sashBrassRing.name = tieBackName;
    sashBrassRing.rotation.y = Math.PI / 2;
    sashBrassRing.position.set(hookX, hookY, hookZ);
    curtainGroup.add(sashBrassRing);
  }

  return curtainGroup;
}
