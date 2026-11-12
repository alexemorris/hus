import { sharedBoxGeometry, sharedCylinderGeometry } from '../shared/geometry-cache.ts';
import * as THREE from 'three';
import type { CircuitId } from '../../core/types/knx.ts';
import type { CutawayWallDescriptor, InteractiveUserData } from '../../core/types/scene.ts';
import type { SceneBuilderContext } from '../../engine/viewer/scene-types.ts';
import {
  getBathroomBrassMaterials,
  resolveFixtureFinishToBrassCode,
} from '../sanitaryware/bathroom-materials.ts';
import type { FixtureMetalFinish } from '../sanitaryware/bathroom-spec-types.ts';

export type CorstonSocketKind =
  | 'double'
  | 'doubleWithLampSocket'
  | 'singleWithLampSocket'
  | 'floorBrassDouble'
  | 'surfaceMetalDouble';

export interface ConnectedLampCordSpec {
  /** KNX lighting circuit controlled by this 5A round-pin lamp socket. */
  readonly circuitId: CircuitId;
  /** KNX physical address of the room's switch / actuator channel for HUD inspection. */
  readonly switchPa?: string;
  readonly switchLocation?: string;
  /**
   * World-space waypoints `[x, y, z]` from the 5A plug cord-grip exit all the way
   * into the connected floor lamp, table lamp, or fairy-light plant pot.
   */
  readonly cordWaypoints: ReadonlyArray<readonly [number, number, number]>;
  /** Optional thin copper wire style when feeding micro-LED fairy lights. */
  readonly isFairyLightWire?: boolean;
}

export interface CorstonSocketPlacement {
  readonly name: string;
  readonly zone: string;
  readonly kind: CorstonSocketKind;
  /** World X coordinate on the wall face (or floor center for `floorBrassDouble`). */
  readonly x: number;
  /**
   * World Y coordinate of the socket centreline.
   * Per UK Building Regulations (Approved Document M / BS 7671), standard wall sockets are
   * mounted at 450mm (0.45m) above Finished Floor Level (FFL), and worktop/alcove sockets
   * at ~150-160mm above the counter surface.
   */
  readonly y: number;
  /** World Z coordinate on the wall face (or floor center for `floorBrassDouble`). */
  readonly z: number;
  /** Direction the socket faceplate faces into the room (`up` for floor sockets). */
  readonly facing: 'north' | 'south' | 'east' | 'west' | 'up';
  /** Optional explicit Y rotation override for angled walls. */
  readonly rotY?: number;
  /**
   * Optional local X offset of the companion 5A lamp socket relative to `(x, y, z)`
   * when `kind === 'doubleWithLampSocket'` (defaults to `+0.088m` on the right, while the
   * double socket is at `-0.058m`; if `lampSocketOffsetX` is explicitly provided, the
   * double socket stays centered at `0` and the 5A lamp socket is placed at `lampSocketOffsetX`).
   */
  readonly lampSocketOffsetX?: number;
  /**
   * Only provided when an actual lamp or fairy-light string is plugged into the 5A socket:
   * adds a 5A plug top, a continuous cord following `cordWaypoints` to the lamp, and binds
   * the 5A socket & plug to the KNX `circuitId`. When omitted, the 5A socket is an empty,
   * unplugged 3-round-pin faceplate on the wall.
   */
  readonly connectedLamp?: ConnectedLampCordSpec;
  /**
   * Optional world-space waypoints `[x, y, z]` for a mains-powered appliance (such as the
   * Roland GP-6-PE baby grand digital piano) plugged into a `floorBrassDouble` floor socket.
   */
  readonly connectedApplianceCordWaypoints?: ReadonlyArray<readonly [number, number, number]>;
  /** Optional cutaway wall descriptor so the socket hides when its host wall is cut away. */
  readonly cutawayWall?: CutawayWallDescriptor;
  /** Optional Corston / Perrin & Rowe metal finish preset (defaults to Corston Antique Brass when omitted). */
  readonly finish?: FixtureMetalFinish;
}

const corstonBrassMat = new THREE.MeshStandardMaterial({
  color: 0xb89146, // Corston Architectural Detail Antique Brass
  roughness: 0.27,
  metalness: 0.85,
});

const corstonDarkBronzeMat = new THREE.MeshStandardMaterial({
  color: 0x5c4422, // Burnished antique brass bevel & screw detail
  roughness: 0.36,
  metalness: 0.78,
});

const bs1363InsertMat = new THREE.MeshStandardMaterial({
  color: 0x18191c, // Matte ebonised black BS 1363 / BS 546 shuttered insert trim
  roughness: 0.44,
  metalness: 0.18,
});

const switchOnRedMat = new THREE.MeshStandardMaterial({
  color: 0xd6281f, // Classic UK BS 1363 red rocker top "ON" indicator line
  roughness: 0.35,
  metalness: 0.1,
});

const lampPlugBodyMat = new THREE.MeshStandardMaterial({
  color: 0x202226, // Moulded 5A round-pin plug top (only rendered when connected to a lamp)
  roughness: 0.38,
  metalness: 0.22,
});

const braidedLampFlexMat = new THREE.MeshStandardMaterial({
  color: 0x2b2520, // Dark bronze-brown braided silk lamp cord
  roughness: 0.76,
  metalness: 0.08,
});

const copperFairyCordMat = new THREE.MeshStandardMaterial({
  color: 0x8a5a32, // Fine insulated copper lead feeding micro-LED fairy lights
  roughness: 0.4,
  metalness: 0.7,
});

/**
 * Adds a single UK BS 1363 13A 3-rectangular-pin shuttered outlet aperture at `(offsetX, 0)`
 * in the faceplate's local XY plane (protruding along `+Z`).
 */
function addBs1363OutletAperture(
  parent: THREE.Group,
  offsetX: number,
  outletTag = 'outlet'
): void {
  const surround = new THREE.Mesh(
    sharedBoxGeometry(0.036, 0.036, 0.0012),
    corstonDarkBronzeMat
  );
  surround.name = `${parent.name}.${outletTag}.surround`;
  surround.position.set(offsetX, -0.002, 0.0186);
  parent.add(surround);

  // Top vertical rectangular Earth slot (4mm x 8mm)
  const earthSlot = new THREE.Mesh(
    sharedBoxGeometry(0.0042, 0.0082, 0.0016),
    bs1363InsertMat
  );
  earthSlot.name = `${parent.name}.${outletTag}.earthSlot`;
  earthSlot.userData.lodTier = 'high';
  earthSlot.userData.lodMaxDistance = 12;
  earthSlot.position.set(offsetX, 0.0095, 0.024);
  parent.add(earthSlot);

  // Bottom-left (Neutral) and bottom-right (Line) horizontal shuttered slots (6.5mm x 4mm, 22.2mm pitch)
  for (const side of [-1, 1] as const) {
    const liveNeutralSlot = new THREE.Mesh(
      sharedBoxGeometry(0.0066, 0.0042, 0.0016),
      bs1363InsertMat
    );
    liveNeutralSlot.name = `${parent.name}.${outletTag}.${side < 0 ? 'neutralSlot' : 'liveSlot'}`;
    liveNeutralSlot.userData.lodTier = 'high';
    liveNeutralSlot.userData.lodMaxDistance = 12;
    liveNeutralSlot.position.set(offsetX + side * 0.0111, -0.0105, 0.024);
    parent.add(liveNeutralSlot);
  }
}

/**
 * Adds a Corston Antique Brass rocker switch with a black trim bezel and red top ON indicator.
 */
function addCorstonRockerSwitch(
  parent: THREE.Group,
  offsetX: number,
  offsetY = 0.005,
  switchTag = 'rockerSwitch'
): void {
  const bezel = new THREE.Mesh(
    sharedBoxGeometry(0.016, 0.026, 0.0016),
    bs1363InsertMat
  );
  bezel.name = `${parent.name}.${switchTag}.bezel`;
  bezel.position.set(offsetX, offsetY, 0.0188);
  parent.add(bezel);

  const rocker = new THREE.Mesh(
    sharedBoxGeometry(0.013, 0.022, 0.0042),
    corstonBrassMat
  );
  rocker.name = `${parent.name}.${switchTag}.rocker`;
  rocker.position.set(offsetX, offsetY, 0.026);
  rocker.rotation.x = 0.14;
  rocker.castShadow = true;
  parent.add(rocker);

  const redPip = new THREE.Mesh(
    sharedBoxGeometry(0.011, 0.0022, 0.0015),
    switchOnRedMat
  );
  redPip.name = `${parent.name}.${switchTag}.redOnPip`;
  redPip.userData.lodTier = 'high';
  redPip.userData.lodMaxDistance = 12;
  redPip.position.set(offsetX, offsetY + 0.0095, 0.032);
  parent.add(redPip);
}

/**
 * Builds a Corston 2-Gang 13A Switched UK BS 1363 Double Socket (`146mm x 86mm x 4.5mm`)
 * centered at `(offsetX, 0, 0)` in `group`.
 */
function addCorstonDouble13ASocketPlate(group: THREE.Group, offsetX = 0): void {
  const plateW = 0.146;
  const plateH = 0.086;

  const bevelPlate = new THREE.Mesh(
    sharedBoxGeometry(plateW, plateH, 0.003),
    corstonDarkBronzeMat
  );
  bevelPlate.name = `${group.name}.bevelPlate`;
  bevelPlate.position.set(offsetX, 0, 0.0055);
  bevelPlate.castShadow = true;
  group.add(bevelPlate);

  const frontPlate = new THREE.Mesh(
    sharedBoxGeometry(plateW - 0.003, plateH - 0.003, 0.003),
    corstonBrassMat
  );
  frontPlate.name = `${group.name}.frontPlate`;
  frontPlate.position.set(offsetX, 0, 0.0125);
  frontPlate.castShadow = true;
  frontPlate.receiveShadow = true;
  group.add(frontPlate);

  // UK BS 4662 2-gang fixing screws at 120.6mm centres (±0.0603m)
  for (const side of [-1, 1] as const) {
    const screw = new THREE.Mesh(
      sharedCylinderGeometry(0.0026, 0.0026, 0.0014, 10),
      corstonDarkBronzeMat
    );
    screw.name = `${group.name}.screw.${side < 0 ? 'left' : 'right'}`;
    screw.userData.lodTier = 'high';
    screw.userData.lodMaxDistance = 12;
    screw.rotation.x = Math.PI / 2;
    screw.position.set(offsetX + side * 0.0603, 0, 0.0187);
    group.add(screw);
  }

  addBs1363OutletAperture(group, offsetX - 0.043, 'outletLeft');
  addBs1363OutletAperture(group, offsetX + 0.043, 'outletRight');
  addCorstonRockerSwitch(group, offsetX - 0.0115, 0.005, 'rockerLeft');
  addCorstonRockerSwitch(group, offsetX + 0.0115, 0.005, 'rockerRight');
}

/**
 * Builds a Corston 1-Gang 13A Switched UK BS 1363 Single Socket (`86mm x 86mm x 4.5mm`)
 * centered at `(offsetX, 0, 0)` in `group`.
 */
function addCorstonSingle13ASocketPlate(group: THREE.Group, offsetX = 0): void {
  const plateW = 0.086;
  const plateH = 0.086;

  const bevelPlate = new THREE.Mesh(
    sharedBoxGeometry(plateW, plateH, 0.003),
    corstonDarkBronzeMat
  );
  bevelPlate.name = `${group.name}.bevelPlate`;
  bevelPlate.position.set(offsetX, 0, 0.0055);
  bevelPlate.castShadow = true;
  group.add(bevelPlate);

  const frontPlate = new THREE.Mesh(
    sharedBoxGeometry(plateW - 0.003, plateH - 0.003, 0.003),
    corstonBrassMat
  );
  frontPlate.name = `${group.name}.frontPlate`;
  frontPlate.position.set(offsetX, 0, 0.0125);
  frontPlate.castShadow = true;
  frontPlate.receiveShadow = true;
  group.add(frontPlate);

  // UK BS 4662 1-gang fixing screws at 60.3mm centres (±0.03015m)
  for (const side of [-1, 1] as const) {
    const screw = new THREE.Mesh(
      sharedCylinderGeometry(0.0026, 0.0026, 0.0014, 10),
      corstonDarkBronzeMat
    );
    screw.name = `${group.name}.screw.${side < 0 ? 'left' : 'right'}`;
    screw.userData.lodTier = 'high';
    screw.userData.lodMaxDistance = 12;
    screw.rotation.x = Math.PI / 2;
    screw.position.set(offsetX + side * 0.03015, 0, 0.0187);
    group.add(screw);
  }

  addBs1363OutletAperture(group, offsetX - 0.008, 'outlet');
  addCorstonRockerSwitch(group, offsetX + 0.018, 0.005, 'rockerSwitch');
}

/**
 * Builds a Corston 1-Gang UK BS 546 5A Unswitched Round-Pin Lighting/Lamp Socket (`86mm x 86mm x 4.5mm`)
 * centered at `(offsetX, 0, 0)` in `group`.
 * - When `withPlug` is `false` (default), it renders a clean, empty 3-round-pin faceplate.
 * - When `withPlug` is `true`, it also adds the 5A round-pin plug top and strain-relief gland.
 */
function addCorston5ALampSocketPlate(
  group: THREE.Group,
  offsetX: number,
  withPlug: boolean
): THREE.Group {
  const lampSubGroup = new THREE.Group();
  lampSubGroup.name = `${group.name}.lampSocket5A`;
  lampSubGroup.position.set(offsetX, 0, 0);

  const plateW = 0.086;
  const plateH = 0.086;

  const bevelPlate = new THREE.Mesh(
    sharedBoxGeometry(plateW, plateH, 0.003),
    corstonDarkBronzeMat
  );
  bevelPlate.name = `${lampSubGroup.name}.bevelPlate`;
  bevelPlate.position.set(0, 0, 0.0055);
  bevelPlate.castShadow = true;
  lampSubGroup.add(bevelPlate);

  const frontPlate = new THREE.Mesh(
    sharedBoxGeometry(plateW - 0.003, plateH - 0.003, 0.003),
    corstonBrassMat
  );
  frontPlate.name = `${lampSubGroup.name}.frontPlate`;
  frontPlate.position.set(0, 0, 0.0125);
  frontPlate.castShadow = true;
  frontPlate.receiveShadow = true;
  lampSubGroup.add(frontPlate);

  for (const side of [-1, 1] as const) {
    const screw = new THREE.Mesh(
      sharedCylinderGeometry(0.0026, 0.0026, 0.0014, 10),
      corstonDarkBronzeMat
    );
    screw.name = `${lampSubGroup.name}.screw.${side < 0 ? 'left' : 'right'}`;
    screw.userData.lodTier = 'high';
    screw.userData.lodMaxDistance = 12;
    screw.rotation.x = Math.PI / 2;
    screw.position.set(side * 0.03015, 0, 0.0187);
    lampSubGroup.add(screw);
  }

  // Subtle recessed dark-bronze bezel ring around the 5A 3-round-pin socket insert
  const roundSurround = new THREE.Mesh(
    sharedCylinderGeometry(0.0205, 0.0205, 0.0012, 20),
    corstonDarkBronzeMat
  );
  roundSurround.name = `${lampSubGroup.name}.roundSurround`;
  roundSurround.rotation.x = Math.PI / 2;
  roundSurround.position.set(0, 0, 0.0186);
  lampSubGroup.add(roundSurround);

  // Circular black BS 546 5A 3-round-pin shuttered socket insert face
  const roundInsert = new THREE.Mesh(
    sharedCylinderGeometry(0.0185, 0.0185, 0.0015, 20),
    bs1363InsertMat
  );
  roundInsert.name = `${lampSubGroup.name}.roundInsert`;
  roundInsert.rotation.x = Math.PI / 2;
  roundInsert.position.set(0, 0, 0.024);
  lampSubGroup.add(roundInsert);

  // 3 round BS 546 pin apertures (top Earth + bottom L/N)
  for (const [pinTag, px, py, pr] of [
    ['earthPin', 0, 0.0095, 0.0028],
    ['neutralPin', -0.0085, -0.007, 0.0023],
    ['livePin', 0.0085, -0.007, 0.0023],
  ] as const) {
    const pinHole = new THREE.Mesh(
      sharedCylinderGeometry(pr, pr, 0.0018, 12),
      corstonDarkBronzeMat
    );
    pinHole.name = `${lampSubGroup.name}.${pinTag}`;
    pinHole.userData.lodTier = 'high';
    pinHole.userData.lodMaxDistance = 12;
    pinHole.rotation.x = Math.PI / 2;
    pinHole.position.set(px, py, 0.0297);
    lampSubGroup.add(pinHole);
  }

  if (withPlug) {
    // Low-profile 5A round-pin plug top seated in the 5A socket
    const plugBody = new THREE.Mesh(
      sharedCylinderGeometry(0.016, 0.0175, 0.014, 18),
      lampPlugBodyMat
    );
    plugBody.name = `${group.name}.lampPlug5A`;
    plugBody.rotation.x = Math.PI / 2;
    plugBody.position.set(0, 0, 0.041);
    plugBody.castShadow = true;
    lampSubGroup.add(plugBody);

    const plugBrassCap = new THREE.Mesh(
      sharedCylinderGeometry(0.0155, 0.016, 0.0024, 18),
      corstonBrassMat
    );
    plugBrassCap.name = `${group.name}.lampPlug5A.brassCap`;
    plugBrassCap.rotation.x = Math.PI / 2;
    plugBrassCap.position.set(0, 0, 0.0532);
    lampSubGroup.add(plugBrassCap);

    const cordGland = new THREE.Mesh(
      sharedCylinderGeometry(0.0038, 0.0048, 0.008, 10),
      corstonBrassMat
    );
    cordGland.name = `${group.name}.lampPlug5A.cordGland`;
    cordGland.userData.lodTier = 'high';
    cordGland.userData.lodMaxDistance = 12;
    cordGland.position.set(0, -0.022, 0.041);
    lampSubGroup.add(cordGland);
  }

  group.add(lampSubGroup);
  return lampSubGroup;
}

/**
 * Builds a Corston Solid Antique Brass 2-Gang Flush Floor Socket (`146mm x 86mm`)
 * with twin spring-hinged brass flap covers and countersunk corner screws.
 * When `withPlug` is `true`, the left-hand (`-0.036m`) flap cover is hinged open and
 * a moulded black UK BS 1363 13A right-angle mains plug is seated in the floor outlet.
 */
function addCorstonFlushBrassFloorSocket(group: THREE.Group, withPlug = false): void {
  const plateW = 0.146;
  const plateD = 0.086;

  const gasket = new THREE.Mesh(
    sharedBoxGeometry(plateW + 0.004, 0.002, plateD + 0.004),
    corstonDarkBronzeMat
  );
  gasket.name = `${group.name}.gasket`;
  gasket.position.set(0, 0.005, 0);
  gasket.receiveShadow = true;
  group.add(gasket);

  const brassPlate = new THREE.Mesh(
    sharedBoxGeometry(plateW, 0.0024, plateD),
    corstonBrassMat
  );
  brassPlate.name = `${group.name}.brassPlate`;
  brassPlate.position.set(0, 0.0112, 0);
  brassPlate.receiveShadow = true;
  group.add(brassPlate);

  for (const sideX of [-0.036, 0.036] as const) {
    const sideLabel = sideX < 0 ? 'left' : 'right';
    const flapRim = new THREE.Mesh(
      sharedBoxGeometry(0.052, 0.0012, 0.062),
      corstonDarkBronzeMat
    );
    flapRim.name = `${group.name}.flap.${sideLabel}.rim`;
    flapRim.position.set(sideX, 0.017, 0);
    group.add(flapRim);

    const hingeBarrel = new THREE.Mesh(
      sharedCylinderGeometry(0.0022, 0.0022, 0.036, 10),
      corstonDarkBronzeMat
    );
    hingeBarrel.name = `${group.name}.flap.${sideLabel}.hingeBarrel`;
    hingeBarrel.userData.lodTier = 'high';
    hingeBarrel.userData.lodMaxDistance = 12;
    hingeBarrel.rotation.z = Math.PI / 2;
    hingeBarrel.position.set(sideX, 0.023, -0.033);
    group.add(hingeBarrel);

    const isOpenWithPlug = withPlug && sideX < 0;
    if (isOpenWithPlug) {
      // Exposed black BS 1363 13A floor socket insert inside the open compartment
      const socketWell = new THREE.Mesh(
        sharedBoxGeometry(0.048, 0.0014, 0.056),
        bs1363InsertMat
      );
      socketWell.name = `${group.name}.flap.${sideLabel}.socketWell`;
      socketWell.position.set(sideX, 0.0223, 0);
      group.add(socketWell);

      // Spring-loaded brass flap lid hinged open ~105° back behind the plug
      const openFlapPivot = new THREE.Group();
      openFlapPivot.name = `${group.name}.openFlap`;
      openFlapPivot.position.set(sideX, 0.023, -0.033);
      openFlapPivot.rotation.x = -1.82;

      const flapLid = new THREE.Mesh(
        sharedBoxGeometry(0.049, 0.0018, 0.058),
        corstonBrassMat
      );
      flapLid.name = `${group.name}.openFlap.lid`;
      flapLid.position.set(0, 0, 0.029);
      flapLid.castShadow = true;
      openFlapPivot.add(flapLid);

      const liftTab = new THREE.Mesh(
        sharedBoxGeometry(0.016, 0.0014, 0.006),
        corstonDarkBronzeMat
      );
      liftTab.name = `${group.name}.openFlap.liftTab`;
      liftTab.userData.lodTier = 'high';
      liftTab.userData.lodMaxDistance = 12;
      liftTab.position.set(0, 0.0056, 0.053);
      openFlapPivot.add(liftTab);
      group.add(openFlapPivot);

      // Seated UK BS 1363 13A right-angle mains plug + strain-relief cord gland exiting toward the piano
      const plugBody = new THREE.Mesh(
        sharedBoxGeometry(0.046, 0.019, 0.05),
        lampPlugBodyMat
      );
      plugBody.name = `${group.name}.plug13A`;
      plugBody.position.set(sideX, 0.0365, 0.002);
      plugBody.castShadow = true;
      group.add(plugBody);

      const plugTopCap = new THREE.Mesh(
        sharedBoxGeometry(0.042, 0.003, 0.046),
        bs1363InsertMat
      );
      plugTopCap.name = `${group.name}.plug13A.topCap`;
      plugTopCap.position.set(sideX, 0.0515, 0.002);
      group.add(plugTopCap);

      const cordGland = new THREE.Mesh(
        sharedCylinderGeometry(0.0042, 0.0054, 0.014, 10),
        lampPlugBodyMat
      );
      cordGland.name = `${group.name}.plug13A.cordGland`;
      cordGland.userData.lodTier = 'high';
      cordGland.userData.lodMaxDistance = 12;
      cordGland.rotation.x = Math.PI / 2;
      cordGland.rotation.z = 0.55;
      cordGland.position.set(sideX - 0.006, 0.034, 0.034);
      group.add(cordGland);
    } else {
      const flapLid = new THREE.Mesh(
        sharedBoxGeometry(0.049, 0.0018, 0.058),
        corstonBrassMat
      );
      flapLid.name = `${group.name}.flap.${sideLabel}.lid`;
      flapLid.position.set(sideX, 0.0225, 0);
      group.add(flapLid);

      const liftTab = new THREE.Mesh(
        sharedBoxGeometry(0.016, 0.0014, 0.006),
        corstonDarkBronzeMat
      );
      liftTab.name = `${group.name}.flap.${sideLabel}.liftTab`;
      liftTab.userData.lodTier = 'high';
      liftTab.userData.lodMaxDistance = 12;
      liftTab.position.set(sideX, 0.0281, 0.024);
      group.add(liftTab);
    }
  }

  for (const sx of [-0.064, 0.064] as const) {
    for (const sz of [-0.034, 0.034] as const) {
      const screw = new THREE.Mesh(
        sharedCylinderGeometry(0.0025, 0.0025, 0.001, 10),
        corstonDarkBronzeMat
      );
      screw.name = `${group.name}.screw.${sx < 0 ? 'left' : 'right'}.${sz < 0 ? 'back' : 'front'}`;
      screw.userData.lodTier = 'high';
      screw.userData.lodMaxDistance = 12;
      screw.position.set(sx, 0.0169, sz);
      group.add(screw);
    }
  }
}

const metalcladBackboxMat = new THREE.MeshStandardMaterial({
  color: 0xbec5ce, // Powder-coated silver-grey pressed steel surface pattress box (MK Metalclad Plus)
  roughness: 0.34,
  metalness: 0.72,
});

const metalcladFaceplateMat = new THREE.MeshStandardMaterial({
  color: 0xd2d8e0, // Heavy-gauge brushed satin steel Metalclad frontplate
  roughness: 0.24,
  metalness: 0.84,
});

const metalcladShadowTrimMat = new THREE.MeshStandardMaterial({
  color: 0x565d66, // Dark zinc-steel gasket / knockout / fixing screw detail
  roughness: 0.38,
  metalness: 0.76,
});

/**
 * Builds an industrial UK BS 1363 2-Gang 13A Surface-Mounted Metalclad Double Socket
 * (`148mm x 88mm x 42mm`, MK Metalclad Plus style) for the Plant Room & Study utility walls.
 */
function addSurfaceMountedMetalDouble13ASocket(group: THREE.Group, offsetX = 0): void {
  const boxW = 0.148;
  const boxH = 0.088;
  const boxD = 0.034;
  const plateD = 0.005;
  const faceZ = 0.053;

  // 1. Pressed-steel surface mounting backbox (pattress)
  const backbox = new THREE.Mesh(
    sharedBoxGeometry(boxW, boxH, boxD),
    metalcladBackboxMat
  );
  backbox.name = `${group.name}.backbox`;
  backbox.position.set(offsetX, 0, 0.021);
  backbox.castShadow = true;
  backbox.receiveShadow = true;
  group.add(backbox);

  // 20mm circular conduit knockout embosses on top & bottom faces of the steel pattress box
  for (const ky of [-boxH * 0.5, boxH * 0.5] as const) {
    for (const kx of [-0.042, 0.042] as const) {
      const knockout = new THREE.Mesh(
        sharedCylinderGeometry(0.01, 0.01, 0.0016, 14),
        metalcladShadowTrimMat
      );
      knockout.name = `${group.name}.knockout.${ky < 0 ? 'bottom' : 'top'}.${kx < 0 ? 'left' : 'right'}`;
      knockout.userData.lodTier = 'high';
      knockout.userData.lodMaxDistance = 12;
      knockout.position.set(offsetX + kx, ky + (ky < 0 ? -0.0048 : 0.0048), 0.021);
      group.add(knockout);
    }
  }

  // Subtle dark steel gasket collar between pattress box and frontplate
  const gasketCollar = new THREE.Mesh(
    sharedBoxGeometry(boxW + 0.001, boxH + 0.001, 0.002),
    metalcladShadowTrimMat
  );
  gasketCollar.name = `${group.name}.gasketCollar`;
  gasketCollar.position.set(offsetX, 0, 0.043);
  group.add(gasketCollar);

  // 2. Heavy-gauge bevelled brushed steel Metalclad frontplate
  const frontplate = new THREE.Mesh(
    sharedBoxGeometry(boxW - 0.002, boxH - 0.002, plateD),
    metalcladFaceplateMat
  );
  frontplate.name = `${group.name}.frontplate`;
  frontplate.position.set(offsetX, 0, 0.0505);
  frontplate.castShadow = true;
  frontplate.receiveShadow = true;
  group.add(frontplate);

  // UK BS 4662 2-gang M3.5 steel fixing screws at 120.6mm centres (±0.0603m)
  for (const side of [-1, 1] as const) {
    const screw = new THREE.Mesh(
      sharedCylinderGeometry(0.0028, 0.0028, 0.0014, 10),
      metalcladShadowTrimMat
    );
    screw.name = `${group.name}.screw.${side < 0 ? 'left' : 'right'}`;
    screw.userData.lodTier = 'high';
    screw.userData.lodMaxDistance = 12;
    screw.rotation.x = Math.PI / 2;
    screw.position.set(offsetX + side * 0.0603, 0, faceZ + 0.0047);
    group.add(screw);
  }

  // 3. Twin BS 1363 13A shuttered outlet inserts at ±0.043m on the frontplate face
  for (const [outletTag, outletX] of [
    ['outletLeft', offsetX - 0.043],
    ['outletRight', offsetX + 0.043],
  ] as const) {
    const surround = new THREE.Mesh(
      sharedBoxGeometry(0.036, 0.036, 0.0014),
      metalcladShadowTrimMat
    );
    surround.name = `${group.name}.${outletTag}.surround`;
    surround.position.set(outletX, -0.002, faceZ + 0.0047);
    group.add(surround);

    const earthSlot = new THREE.Mesh(
      sharedBoxGeometry(0.0042, 0.0082, 0.0018),
      bs1363InsertMat
    );
    earthSlot.name = `${group.name}.${outletTag}.earthSlot`;
    earthSlot.userData.lodTier = 'high';
    earthSlot.userData.lodMaxDistance = 12;
    earthSlot.position.set(outletX, 0.0095, faceZ + 0.0103);
    group.add(earthSlot);

    for (const pinSide of [-1, 1] as const) {
      const liveNeutralSlot = new THREE.Mesh(
        sharedBoxGeometry(0.0066, 0.0042, 0.0018),
        bs1363InsertMat
      );
      liveNeutralSlot.name = `${group.name}.${outletTag}.${pinSide < 0 ? 'neutralSlot' : 'liveSlot'}`;
      liveNeutralSlot.userData.lodTier = 'high';
      liveNeutralSlot.userData.lodMaxDistance = 12;
      liveNeutralSlot.position.set(outletX + pinSide * 0.0111, -0.0105, faceZ + 0.0103);
      group.add(liveNeutralSlot);
    }
  }

  // 4. Twin Metalclad rocker switches with black bezels and red ON indicators at ±0.0115m
  for (const [switchTag, switchX] of [
    ['rockerLeft', offsetX - 0.0115],
    ['rockerRight', offsetX + 0.0115],
  ] as const) {
    const bezel = new THREE.Mesh(
      sharedBoxGeometry(0.016, 0.026, 0.0016),
      bs1363InsertMat
    );
    bezel.name = `${group.name}.${switchTag}.bezel`;
    bezel.position.set(switchX, 0.005, faceZ + 0.0048);
    group.add(bezel);

    const rocker = new THREE.Mesh(
      sharedBoxGeometry(0.013, 0.022, 0.0044),
      bs1363InsertMat
    );
    rocker.name = `${group.name}.${switchTag}.rocker`;
    rocker.position.set(switchX, 0.005, faceZ + 0.012);
    rocker.rotation.x = 0.14;
    rocker.castShadow = true;
    group.add(rocker);

    const redPip = new THREE.Mesh(
      sharedBoxGeometry(0.011, 0.0022, 0.0016),
      switchOnRedMat
    );
    redPip.name = `${group.name}.${switchTag}.redOnPip`;
    redPip.userData.lodTier = 'high';
    redPip.userData.lodMaxDistance = 12;
    redPip.position.set(switchX, 0.0145, faceZ + 0.018);
    group.add(redPip);
  }
}

/**
 * Builds a single Corston Architectural Detail (or surface-mounted Metalclad) socket assembly and adds it to the scene.
 */
export function buildCorstonPowerSocket(
  ctx: SceneBuilderContext,
  tagCutawayWall: (obj: THREE.Object3D, desc: CutawayWallDescriptor) => void,
  placement: CorstonSocketPlacement
): THREE.Group {
  const group = new THREE.Group();
  group.name = placement.name;
  group.userData.zone = placement.zone;
  group.position.set(placement.x, placement.y, placement.z);

  let lampSubGroup: THREE.Group | null = null;

  if (placement.kind === 'floorBrassDouble') {
    addCorstonFlushBrassFloorSocket(
      group,
      Boolean(placement.connectedApplianceCordWaypoints)
    );
  } else {
    group.rotation.y =
      placement.rotY !== undefined
        ? placement.rotY
        : placement.facing === 'south'
          ? 0
          : placement.facing === 'north'
            ? Math.PI
            : placement.facing === 'east'
              ? Math.PI / 2
              : -Math.PI / 2;

    const hasConnectedLamp = Boolean(placement.connectedLamp);

    if (placement.kind === 'double') {
      addCorstonDouble13ASocketPlate(group, 0);
    } else if (placement.kind === 'surfaceMetalDouble') {
      addSurfaceMountedMetalDouble13ASocket(group, 0);
    } else if (placement.kind === 'doubleWithLampSocket') {
      if (placement.lampSocketOffsetX !== undefined) {
        addCorstonDouble13ASocketPlate(group, 0);
        lampSubGroup = addCorston5ALampSocketPlate(
          group,
          placement.lampSocketOffsetX,
          hasConnectedLamp
        );
      } else {
        // 2-Gang 13A Switched Double Socket (146mm) + 1-Gang 5A Round-Pin Lamp Socket (86mm) side-by-side
        addCorstonDouble13ASocketPlate(group, -0.058);
        lampSubGroup = addCorston5ALampSocketPlate(group, 0.088, hasConnectedLamp);
      }
    } else if (placement.kind === 'singleWithLampSocket') {
      // 1-Gang 13A Switched Single Socket (86mm) + 1-Gang 5A Round-Pin Lamp Socket (86mm) side-by-side
      addCorstonSingle13ASocketPlate(group, -0.055);
      lampSubGroup = addCorston5ALampSocketPlate(group, 0.055, hasConnectedLamp);
    }
  }

  if (placement.finish && placement.kind !== 'surfaceMetalDouble') {
    const pal = getBathroomBrassMaterials(resolveFixtureFinishToBrassCode(placement.finish));
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        if (m.material === corstonBrassMat) {
          m.material = pal.primary;
        } else if (m.material === corstonDarkBronzeMat) {
          m.material = pal.darkShadow;
        }
      }
    });
  }

  if (placement.cutawayWall) {
    tagCutawayWall(group, placement.cutawayWall);
  }

  ctx.scene.add(group);

  // If this floor socket has a connected mains appliance cord (e.g. Roland GP-6-PE baby grand piano),
  // route the continuous braided mains flex from the 13A floor plug up to the appliance's underbelly DC brick.
  if (
    placement.connectedApplianceCordWaypoints &&
    placement.connectedApplianceCordWaypoints.length >= 2
  ) {
    const applianceSegments = Math.max(20, placement.connectedApplianceCordWaypoints.length * 6);
    const minApplianceY = Math.min(...placement.connectedApplianceCordWaypoints.map(([, wy]) => wy));
    const rawApplianceCurve = new THREE.CatmullRomCurve3(
      placement.connectedApplianceCordWaypoints.map(([wx, wy, wz]) => new THREE.Vector3(wx, wy, wz)),
      false,
      'centripetal'
    );
    const clampedAppliancePts = rawApplianceCurve.getPoints(applianceSegments).map((pt) => {
      pt.y = Math.max(pt.y, minApplianceY);
      return pt;
    });
    const cordCurve = new THREE.CatmullRomCurve3(clampedAppliancePts, false, 'centripetal');
    const cordMesh = new THREE.Mesh(
      new THREE.TubeGeometry(
        cordCurve,
        applianceSegments,
        0.0034,
        8,
        false
      ),
      braidedLampFlexMat
    );
    cordMesh.name = `${placement.name}.powerCord`;
    cordMesh.userData = { zone: placement.zone };
    cordMesh.castShadow = true;
    ctx.scene.add(cordMesh);

    const endPt =
      placement.connectedApplianceCordWaypoints[
        placement.connectedApplianceCordWaypoints.length - 1
      ]!;
    const dcBrick = new THREE.Mesh(
      sharedBoxGeometry(0.11, 0.032, 0.052),
      lampPlugBodyMat
    );
    dcBrick.name = `${placement.name}.powerAdapterBrick`;
    dcBrick.userData = { zone: placement.zone };
    dcBrick.position.set(endPt[0], endPt[1], endPt[2]);
    dcBrick.rotation.y = 0.92;
    dcBrick.castShadow = true;
    ctx.scene.add(dcBrick);
  }

  // If this 5A lamp socket is connected to a lamp or fairy-light string, build the continuous
  // world-space cord to the lamp and bind both the 5A socket and cord to the KNX circuit.
  if (placement.connectedLamp && lampSubGroup) {
    const { circuitId, switchPa, switchLocation, cordWaypoints, isFairyLightWire } =
      placement.connectedLamp;
    const knxUserData: InteractiveUserData = {
      circuitId,
      ...(switchPa ? { switchPa } : {}),
      ...(switchLocation ? { switchLocation } : {}),
    };

    lampSubGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.userData = { ...child.userData, ...knxUserData };
        ctx.interactiveMeshes.push(child);
      }
    });
    ctx.interactions.registerLightFixture(lampSubGroup, circuitId);

    if (cordWaypoints.length >= 2) {
      const cordSegments = Math.max(16, cordWaypoints.length * 6);
      const minCordY = Math.min(...cordWaypoints.map(([, wy]) => wy));
      const rawCordCurve = new THREE.CatmullRomCurve3(
        cordWaypoints.map(([wx, wy, wz]) => new THREE.Vector3(wx, wy, wz)),
        false,
        'centripetal'
      );
      const clampedCordPts = rawCordCurve.getPoints(cordSegments).map((pt) => {
        pt.y = Math.max(pt.y, minCordY);
        return pt;
      });
      const cordCurve = new THREE.CatmullRomCurve3(clampedCordPts, false, 'centripetal');
      const cordMesh = new THREE.Mesh(
        new THREE.TubeGeometry(
          cordCurve,
          cordSegments,
          isFairyLightWire ? 0.0018 : 0.0028,
          7,
          false
        ),
        isFairyLightWire ? copperFairyCordMat : braidedLampFlexMat
      );
      cordMesh.name = `${placement.name}.lampCord`;
      cordMesh.userData = { zone: placement.zone, ...knxUserData };
      cordMesh.castShadow = true;
      if (placement.cutawayWall) {
        cordMesh.geometry.computeBoundingBox();
        const cordBox = cordMesh.geometry.boundingBox;
        const cordCenterCoord = cordBox
          ? placement.cutawayWall.axis === 'x'
            ? (cordBox.min.x + cordBox.max.x) * 0.5
            : (cordBox.min.z + cordBox.max.z) * 0.5
          : placement.cutawayWall.coord;
        if (Math.abs(cordCenterCoord - placement.cutawayWall.coord) <= 0.45) {
          tagCutawayWall(cordMesh, placement.cutawayWall);
        }
      }
      ctx.scene.add(cordMesh);
      ctx.interactiveMeshes.push(cordMesh);
      ctx.interactions.registerLightFixture(cordMesh, circuitId);
    }
  }

  return group;
}
