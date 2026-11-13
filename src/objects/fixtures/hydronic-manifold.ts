import * as THREE from 'three';
import { getOrCreateCachedPropTexture } from '../../engine/textures/texture-registry.ts';

/**
 * Creates a procedural 128x128 canvas texture for a hydronic bimetal temperature gauge dial (0–80°C).
 */
export function createTemperatureGaugeDialTexture(isFlowRed: boolean): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture(`manifold:gauge:${isFlowRed ? 1 : 0}`, () => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Crisp white enamel gauge face
    ctx.fillStyle = '#f8f9fa';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();

    // Outer colored temperature arc band (0°C to 80°C)
    ctx.strokeStyle = isFlowRed ? '#d92626' : '#1e6bd6';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 48, Math.PI * 0.75, Math.PI * 2.25);
    ctx.stroke();

    // Tick marks around the scale
    ctx.strokeStyle = '#1e2229';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      const angle = Math.PI * 0.75 + (i / 8) * (Math.PI * 1.5);
      const rInner = i % 2 === 0 ? 36 : 40;
      const rOuter = 46;
      ctx.beginPath();
      ctx.moveTo(64 + Math.cos(angle) * rInner, 64 + Math.sin(angle) * rInner);
      ctx.lineTo(64 + Math.cos(angle) * rOuter, 64 + Math.sin(angle) * rOuter);
      ctx.stroke();
    }

    // °C label text
    ctx.fillStyle = '#1e2229';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('°C', 64, 88);

    // Temperature pointer needle (Flow ~ 44°C, Return ~ 34°C)
    const needleValue = isFlowRed ? 44 : 34;
    const needleAngle = Math.PI * 0.75 + (needleValue / 80) * (Math.PI * 1.5);
    ctx.strokeStyle = isFlowRed ? '#c81e1e' : '#1558b8';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(64 - Math.cos(needleAngle) * 10, 64 - Math.sin(needleAngle) * 10);
    ctx.lineTo(64 + Math.cos(needleAngle) * 42, 64 + Math.sin(needleAngle) * 42);
    ctx.stroke();

    // Center boss cap
    ctx.fillStyle = '#22262c';
    ctx.beginPath();
    ctx.arc(64, 64, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

export interface HydronicManifoldAssemblyOptions {
  readonly prefix: string;
  readonly zoneId?: string;
  readonly position: readonly [number, number, number];
  readonly rotationY?: number;
  readonly numPorts: number;
  readonly brassMat: THREE.Material;
  readonly castIronMat: THREE.Material;
}

/**
 * Builds a reusable local-frame stainless-steel hydronic underfloor heating manifold
 * & mixing pump station with sight-glass flowmeters, electro-thermal actuators,
 * temperature dial gauges, Eurocone fittings, and PEX-AL-PEX floor drops.
 */
export function buildHydronicManifoldAssembly(
  scene: THREE.Object3D,
  options: HydronicManifoldAssemblyOptions
): THREE.Group {
  const {
    prefix,
    zoneId,
    position: [posX, floorY, posZ],
    rotationY: rotY = 0,
    numPorts,
    brassMat,
    castIronMat,
  } = options;
  const manifoldGroup = new THREE.Group();
  manifoldGroup.name = prefix;
  if (zoneId !== undefined) {
    manifoldGroup.userData.zone = zoneId;
  }
  manifoldGroup.position.set(posX, floorY, posZ);
  manifoldGroup.rotation.y = rotY;

  const cabinetWhiteSteelMat = new THREE.MeshStandardMaterial({
    color: 0xf2f4f7,
    roughness: 0.32,
    metalness: 0.35,
  });
  const cabinetRecessInteriorMat = new THREE.MeshStandardMaterial({
    color: 0xdce1e7,
    roughness: 0.42,
    metalness: 0.45,
  });
  const galvSteelMat = new THREE.MeshStandardMaterial({
    color: 0xb8c0c8,
    roughness: 0.3,
    metalness: 0.78,
  });
  const brushedStainlessMat = new THREE.MeshStandardMaterial({
    color: 0xd8dde2,
    roughness: 0.22,
    metalness: 0.88,
  });
  const copperPipeMat = new THREE.MeshStandardMaterial({
    color: 0xc86d44,
    roughness: 0.26,
    metalness: 0.85,
  });
  const epdmRubberMat = new THREE.MeshStandardMaterial({
    color: 0x1e2226,
    roughness: 0.78,
    metalness: 0.05,
  });
  const flowRedMat = new THREE.MeshStandardMaterial({
    color: 0xd62420,
    roughness: 0.28,
    metalness: 0.15,
  });
  const returnBlueMat = new THREE.MeshStandardMaterial({
    color: 0x1862c8,
    roughness: 0.28,
    metalness: 0.15,
  });
  const pumpCompositeBlackMat = new THREE.MeshStandardMaterial({
    color: 0x181b20,
    roughness: 0.36,
    metalness: 0.12,
  });
  const sightGlassClearMat = new THREE.MeshStandardMaterial({
    color: 0xeaf4ff,
    transparent: true,
    opacity: 0.46,
    roughness: 0.12,
    metalness: 0.08,
  });
  const actuatorWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xf5f7fa,
    roughness: 0.28,
    metalness: 0.06,
  });
  const actuatorWarmLedMat = new THREE.MeshStandardMaterial({
    color: 0xff5522,
    emissive: 0xe63800,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  const pexAlPexPipeMat = new THREE.MeshStandardMaterial({
    color: 0xedeff2,
    roughness: 0.34,
    metalness: 0.08,
  });
  const flowGaugeDialMat = new THREE.MeshStandardMaterial({
    map: createTemperatureGaugeDialTexture(true),
    roughness: 0.2,
  });
  const returnGaugeDialMat = new THREE.MeshStandardMaterial({
    map: createTemperatureGaugeDialTexture(false),
    roughness: 0.2,
  });

  // Compact Surface-Mounted Sheet-Steel Manifold Cabinet (0.50m W x 0.48m H)
  const cabinetW = 0.52;
  const cabinetH = 0.48;
  const cabinetCenterY = 0.54;

  const backplate = new THREE.Mesh(
    new THREE.BoxGeometry(cabinetW, cabinetH, 0.01),
    cabinetWhiteSteelMat
  );
  backplate.name = `${prefix}.cabinetBackplate`;
  backplate.position.set(0, cabinetCenterY, 0.005);
  manifoldGroup.add(backplate);

  const innerPan = new THREE.Mesh(
    new THREE.BoxGeometry(cabinetW - 0.03, cabinetH - 0.03, 0.006),
    cabinetRecessInteriorMat
  );
  innerPan.name = `${prefix}.cabinetInnerPan`;
  innerPan.position.set(0, cabinetCenterY, 0.01);
  manifoldGroup.add(innerPan);

  const flangeDepth = 0.088;
  const topHood = new THREE.Mesh(
    new THREE.BoxGeometry(cabinetW, 0.016, flangeDepth),
    cabinetWhiteSteelMat
  );
  topHood.name = `${prefix}.cabinetTopHood`;
  topHood.position.set(0, cabinetCenterY + cabinetH * 0.5 - 0.008, flangeDepth * 0.5);
  manifoldGroup.add(topHood);

  for (const sideSign of [-1, 1] as const) {
    const sideCheek = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, cabinetH, flangeDepth),
      cabinetWhiteSteelMat
    );
    sideCheek.name = `${prefix}.cabinetSideCheek.${sideSign < 0 ? 'left' : 'right'}`;
    sideCheek.position.set(sideSign * (cabinetW * 0.5 - 0.008), cabinetCenterY, flangeDepth * 0.5);
    manifoldGroup.add(sideCheek);
  }

  // Upper KNX UFH Wiring Center & Actuator Controller Bar (local Y = 0.814m)
  const wiringCenterY = cabinetCenterY + cabinetH * 0.5 + 0.034;
  const wiringBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.062, 0.048),
    cabinetWhiteSteelMat
  );
  wiringBox.name = `${prefix}.knxWiringCenter`;
  wiringBox.position.set(0.03, wiringCenterY, 0.024);
  manifoldGroup.add(wiringBox);

  const wiringWin = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.018, 0.004),
    epdmRubberMat
  );
  wiringWin.name = `${prefix}.knxWiringCenter.statusWindow`;
  wiringWin.position.set(0.03, wiringCenterY + 0.005, 0.049);
  manifoldGroup.add(wiringWin);

  for (let zLed = 0; zLed < numPorts; zLed++) {
    const ledMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.007, 0.004),
      actuatorWarmLedMat
    );
    ledMesh.name = `${prefix}.wiringLed.${zLed + 1}`;
    ledMesh.userData.lodTier = 'high';
    ledMesh.userData.lodMaxDistance = 12;
    ledMesh.position.set(-0.07 + zLed * 0.058, wiringCenterY + 0.005, 0.051);
    manifoldGroup.add(ledMesh);
  }

  // Flow & Return Stainless-Steel Header Bars
  const flowHeaderY = 0.66;
  const returnHeaderY = 0.42;
  const flowHeaderZ = 0.064;
  const returnHeaderZ = 0.082;
  const headerCenterX = 0.035;
  const headerWidth = 0.34;
  const headerCrossSection = 0.038;

  const flowHeaderBar = new THREE.Mesh(
    new THREE.BoxGeometry(headerWidth, headerCrossSection, headerCrossSection),
    brushedStainlessMat
  );
  flowHeaderBar.name = `${prefix}.flowHeaderBar`;
  flowHeaderBar.position.set(headerCenterX, flowHeaderY, flowHeaderZ);
  manifoldGroup.add(flowHeaderBar);

  const returnHeaderBar = new THREE.Mesh(
    new THREE.BoxGeometry(headerWidth, headerCrossSection, headerCrossSection),
    brushedStainlessMat
  );
  returnHeaderBar.name = `${prefix}.returnHeaderBar`;
  returnHeaderBar.position.set(headerCenterX, returnHeaderY, returnHeaderZ);
  manifoldGroup.add(returnHeaderBar);

  for (const [bIdx, bx] of ([-0.09, 0.16] as const).entries()) {
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.34, 0.016),
      galvSteelMat
    );
    bracket.name = `${prefix}.mountingBracket.${bIdx + 1}`;
    bracket.position.set(bx, (flowHeaderY + returnHeaderY) * 0.5, 0.018);
    manifoldGroup.add(bracket);
  }

  // Left-Side 28mm Insulated Primary Copper Feed Risers + Isolation Ball Valves +
  //    Thermostatic Blending Valve + Grundfos UPM3 Circulation Pump
  const pumpAxisX = -0.175;
  const returnDropX = -0.22;

  for (const [rx, topY, rz, leverMat, valveName] of [
    [pumpAxisX, flowHeaderY, flowHeaderZ, flowRedMat, `${prefix}.flowIsolationValve`],
    [returnDropX, returnHeaderY, returnHeaderZ, returnBlueMat, `${prefix}.returnIsolationValve`],
  ] as const) {
    const riser = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, topY, 12),
      copperPipeMat
    );
    riser.name = `${valveName}.riserPipe`;
    riser.position.set(rx, topY * 0.5, rz);
    manifoldGroup.add(riser);

    const valveBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.019, 0.019, 0.046, 12),
      brassMat
    );
    valveBody.name = valveName;
    valveBody.position.set(rx, 0.24, rz);
    manifoldGroup.add(valveBody);

    const lever = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.075, 0.007),
      leverMat
    );
    lever.name = `${valveName}.leverHandle`;
    lever.position.set(rx, 0.21, rz + 0.028);
    manifoldGroup.add(lever);
  }

  const mixBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.021, 0.021, 0.056, 14),
    brassMat
  );
  mixBody.name = `${prefix}.thermostaticMixingValve`;
  mixBody.position.set(pumpAxisX, flowHeaderY, flowHeaderZ);
  manifoldGroup.add(mixBody);

  const mixHead = new THREE.Mesh(
    new THREE.CylinderGeometry(0.019, 0.022, 0.042, 16),
    pumpCompositeBlackMat
  );
  mixHead.name = `${prefix}.thermostaticMixingValve.handwheelHead`;
  mixHead.rotation.x = Math.PI / 2;
  mixHead.position.set(pumpAxisX, flowHeaderY, flowHeaderZ + 0.032);
  manifoldGroup.add(mixHead);

  const pumpCenterY = (flowHeaderY + returnHeaderY) * 0.5;
  const pumpCenterZ = (flowHeaderZ + returnHeaderZ) * 0.5;
  const pumpVolute = new THREE.Mesh(
    new THREE.CylinderGeometry(0.038, 0.038, 0.11, 16),
    castIronMat
  );
  pumpVolute.name = `${prefix}.circulationPump`;
  pumpVolute.position.set(pumpAxisX, pumpCenterY, pumpCenterZ);
  manifoldGroup.add(pumpVolute);

  const pumpBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.074, 0.092, 0.036),
    pumpCompositeBlackMat
  );
  pumpBox.name = `${prefix}.circulationPump.controlBox`;
  pumpBox.position.set(pumpAxisX, pumpCenterY, pumpCenterZ + 0.04);
  manifoldGroup.add(pumpBox);

  const pumpStripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.064, 0.007, 0.004),
    flowRedMat
  );
  pumpStripe.name = `${prefix}.circulationPump.accentStripe`;
  pumpStripe.userData.lodTier = 'high';
  pumpStripe.userData.lodMaxDistance = 12;
  pumpStripe.position.set(pumpAxisX, pumpCenterY + 0.032, pumpCenterZ + 0.059);
  manifoldGroup.add(pumpStripe);

  for (const [gy, gz, caseMat, dialMat, gName] of [
    [flowHeaderY, flowHeaderZ + 0.022, flowRedMat, flowGaugeDialMat, `${prefix}.flowTempGauge`],
    [returnHeaderY, returnHeaderZ + 0.022, returnBlueMat, returnGaugeDialMat, `${prefix}.returnTempGauge`],
  ] as const) {
    const bezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.014, 18),
      caseMat
    );
    bezel.name = gName;
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(-0.115, gy, gz + 0.012);
    manifoldGroup.add(bezel);

    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.0185, 18), dialMat);
    dial.name = `${gName}.dialFace`;
    dial.position.set(-0.115, gy, gz + 0.0195);
    manifoldGroup.add(dial);
  }

  // Hydronic Zone Ports (Flowmeters + KNX Electro-Thermal Actuators + PEX-AL-PEX Pipes)
  const firstPortX = -0.06;
  const portPitchX = 0.055;

  for (let i = 0; i < numPorts; i++) {
    const portX = firstPortX + i * portPitchX;
    const circuitNum = i + 1;

    const fmTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0075, 0.0075, 0.04, 10),
      sightGlassClearMat
    );
    fmTube.name = `${prefix}.flowmeter.${circuitNum}`;
    fmTube.position.set(portX, flowHeaderY + headerCrossSection * 0.5 + 0.024, flowHeaderZ);
    manifoldGroup.add(fmTube);

    const fmFloat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 10),
      flowRedMat
    );
    fmFloat.name = `${prefix}.flowmeter.${circuitNum}.floatIndicator`;
    fmFloat.userData.lodTier = 'high';
    fmFloat.userData.lodMaxDistance = 12;
    fmFloat.position.set(portX, flowHeaderY + headerCrossSection * 0.5 + 0.026, flowHeaderZ);
    manifoldGroup.add(fmFloat);

    const actBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.0125, 0.042, 14),
      actuatorWhiteMat
    );
    actBody.name = `${prefix}.zoneActuator.${circuitNum}`;
    actBody.position.set(portX, returnHeaderY + headerCrossSection * 0.5 + 0.024, returnHeaderZ);
    manifoldGroup.add(actBody);

    const actCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.0135, 0.01, 14),
      actuatorWarmLedMat
    );
    actCap.name = `${prefix}.zoneActuator.${circuitNum}.statusCap`;
    actCap.position.set(portX, returnHeaderY + headerCrossSection * 0.5 + 0.048, returnHeaderZ);
    manifoldGroup.add(actCap);

    for (const [isReturnPipe, hY, pZ] of [
      [false, flowHeaderY, flowHeaderZ],
      [true, returnHeaderY, returnHeaderZ],
    ] as const) {
      const euroconeTopY = hY - headerCrossSection * 0.5;
      const nut = new THREE.Mesh(
        new THREE.CylinderGeometry(0.011, 0.011, 0.018, 6),
        brassMat
      );
      nut.name = isReturnPipe
        ? `${prefix}.returnEurocone.${circuitNum}`
        : `${prefix}.flowEurocone.${circuitNum}`;
      nut.position.set(portX, euroconeTopY - 0.009, pZ);
      manifoldGroup.add(nut);

      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0085, 0.0085, 0.006, 10),
        isReturnPipe ? returnBlueMat : flowRedMat
      );
      collar.name = isReturnPipe
        ? `${prefix}.returnCollar.${circuitNum}`
        : `${prefix}.flowCollar.${circuitNum}`;
      collar.userData.lodTier = 'high';
      collar.userData.lodMaxDistance = 12;
      collar.position.set(portX, euroconeTopY - 0.02, pZ);
      manifoldGroup.add(collar);

      const pexLen = euroconeTopY - 0.02;
      const pexPipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0075, 0.0075, pexLen, 8),
        pexAlPexPipeMat
      );
      pexPipe.name = isReturnPipe
        ? `${prefix}.pexReturnPipe.${circuitNum}`
        : `${prefix}.pexFlowPipe.${circuitNum}`;
      pexPipe.position.set(portX, pexLen * 0.5, pZ);
      manifoldGroup.add(pexPipe);
    }
  }

  // Right-End Automatic Brass Air Vents (AAV) & Drain Valves
  const rightEndX = headerCenterX + headerWidth * 0.5 + 0.018;
  for (const [isRet, hY, hZ] of [
    [false, flowHeaderY, flowHeaderZ],
    [true, returnHeaderY, returnHeaderZ],
  ] as const) {
    const aavBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.04, 12),
      brassMat
    );
    aavBody.name = isRet
      ? `${prefix}.returnAutoAirVent`
      : `${prefix}.flowAutoAirVent`;
    aavBody.position.set(rightEndX, hY + 0.036, hZ);
    manifoldGroup.add(aavBody);

    const aavCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0055, 0.0065, 0.01, 10),
      flowRedMat
    );
    aavCap.name = `${aavBody.name}.bleedCap`;
    aavCap.userData.lodTier = 'high';
    aavCap.userData.lodMaxDistance = 12;
    aavCap.position.set(rightEndX, hY + 0.06, hZ);
    manifoldGroup.add(aavCap);
  }

  // Galvanized Floor Pipe Shroud above floorY
  const shroud = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.108, 0.11),
    galvSteelMat
  );
  shroud.name = `${prefix}.floorPipeShroud`;
  shroud.position.set(0.035, 0.066, 0.055);
  manifoldGroup.add(shroud);

  scene.add(manifoldGroup);
  return manifoldGroup;
}
