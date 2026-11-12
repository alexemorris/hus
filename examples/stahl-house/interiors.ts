import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  attachAssetMetadata,
  attachAudioEmitter,
  buildCorstonToggleSwitch,
  buildHallWoodBurningStoveFirebox,
  extrudePlanarSolidWithHoles,
  prepGeo,
  registerHingedDoor,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import { buildBreezewayAndCentralBathCore, buildStahlKitchenBay } from './kitchen-and-bath.ts';
import {
  buildFlorenceKnollCredenza,
  buildMasterAndBedroom2Furnishings,
} from './mcm-bedrooms.ts';
import {
  addSheerPinchPleatDraperyStack,
  buildEamesLoungeAndOttoman,
  buildFlorenceKnollSofa,
  buildSaarinenDiningSetAndNelsonPendant,
  buildTravertineCoffeeTable,
  buildVkgSlingLoungeChair,
  buildWalnutTripodFloorLamp,
} from './mcm-furniture.ts';
import { getMcmMaterials, metricBox } from './mcm-materials.ts';
import type { StahlMaterials } from './structure.ts';
import { CLEAR_CEILING_Y, X1, X2, X3, X4, Z0, Z1, Z2, Z3 } from './terrain.ts';

function addSpunAluminumCone(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  circuitId: string,
  x: number,
  z: number,
  hex = 0xffd59e
): void {
  const grp = (ctx.lightGroups as Record<string, LightCircuitGroup>)[circuitId];
  const cone = new THREE.Mesh(
    prepGeo(new THREE.ConeGeometry(0.085, 0.17, 16, 1, true)),
    new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.85, roughness: 0.25, side: THREE.DoubleSide })
  );
  const coneTopY = CLEAR_CEILING_Y - 0.038;
  cone.position.set(x, coneTopY - 0.085, z);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff8eb,
    emissive: new THREE.Color(hex),
    emissiveIntensity: 1.5,
  });
  const bulb = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.042, 12, 10)), bulbMat);
  bulb.position.set(x, coneTopY - 0.11, z);
  parent.add(cone, bulb);
  if (grp) grp.emissives.push(bulbMat);
  ctx.addGlowPool(circuitId as never, x, 0.008, z, 1.35, 0.2);
}

function attachCircuitPointLight(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  circuitId: string,
  pos: readonly [number, number, number],
  hex: number,
  intensity = 2.6,
  distance = 9.5
): void {
  const grp = (ctx.lightGroups as Record<string, LightCircuitGroup>)[circuitId];
  const pl = new THREE.PointLight(hex, intensity, distance, 2);
  pl.position.set(pos[0], pos[1], pos[2]);
  parent.add(pl);
  if (grp) grp.lights.push(pl);
}

function addArchitecturalPotteryPlanter(
  parent: THREE.Object3D,
  x: number,
  z: number,
  porcelainMat: THREE.Material,
  foliageMat: THREE.Material
): void {
  const g = new THREE.Group();
  g.name = 'stahl.living.architecturalPotteryPlanter';
  g.position.set(x, 0.0006, z);

  const standLegGeo = prepGeo(new THREE.BoxGeometry(0.016, 0.26, 0.016));
  for (const [lx, lz] of [[-0.16, 0], [0.16, 0], [0, -0.16], [0, 0.16]] as const) {
    const leg = new THREE.Mesh(standLegGeo, new THREE.MeshStandardMaterial({ color: 0x262523, roughness: 0.45 }));
    leg.position.set(lx, 0.13, lz);
    g.add(leg);
  }
  const pot = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.18, 0.175, 0.34, 24)), porcelainMat);
  pot.position.y = 0.23;
  pot.castShadow = true;
  g.add(pot);

  // Sculptural Sansevieria / architectural agave blades
  for (let i = 0; i < 7; i++) {
    const a = (i * Math.PI * 2) / 7;
    const h = 0.36 + (i % 3) * 0.08;
    const blade = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.032, h, 5)), foliageMat);
    blade.scale.set(1, 1, 0.32);
    blade.position.set(Math.cos(a) * 0.065, 0.38 + h * 0.45, Math.sin(a) * 0.065);
    blade.rotation.y = -a;
    blade.rotation.z = -0.11;
    g.add(blade);
  }

  attachAssetMetadata(g, {
    name: 'Architectural Pottery Model MP-17 Matte White Cylinder Planter & Stand',
    brand: 'Architectural Pottery (Manhattan Beach, CA)',
    collection: 'LaGardo Tackett / John Follis Case Study Series',
    sku: 'AP-MP17-WHT',
    finish: 'Matte Unglazed White Stoneware, Walnut/Steel Cradle & Sansevieria',
    category: 'decor',
    dimensionsMm: [360, 360, 780],
  });

  parent.add(g);
}

export function buildStahlInteriors(
  ctx: SceneBuilderContext,
  root: THREE.Group,
  mats: StahlMaterials,
  cuts: { readonly northWoodsCut: CutawayWallDescriptor; readonly westCarportCut: CutawayWallDescriptor }
): void {
  const mcm = getMcmMaterials();
  const ceilingTopY = CLEAR_CEILING_Y - 0.038;

  const eastCliffCut: CutawayWallDescriptor = {
    axis: 'x',
    coord: X4,
    minSpan: Z0,
    maxSpan: Z3,
    floor: 'ground',
    outwardSide: 'east',
  };
  const southCliffCut: CutawayWallDescriptor = {
    axis: 'z',
    coord: Z3,
    minSpan: X3,
    maxSpan: X4,
    floor: 'ground',
    outwardSide: 'south',
  };
  const westPoolLivingCut: CutawayWallDescriptor = {
    axis: 'x',
    coord: X3,
    minSpan: Z1,
    maxSpan: Z3,
    floor: 'ground',
    outwardSide: 'west',
  };

  // =========================================================================
  // 1. KOENIG 4-SIDED SUSPENDED SHEET-METAL FIREPLACE (`X = 2.95, Z = 6.096`)
  // =========================================================================
  const fpGroup = new THREE.Group();
  fpGroup.name = 'stahl.living.fireplace';
  fpGroup.position.set(2.95, 0, Z2);

  const hearth = new THREE.Mesh(metricBox(2.15, 0.28, 0.96, 0.9, 0.9), mcm.travertine);
  hearth.position.y = 0.1406;
  hearth.castShadow = hearth.receiveShadow = true;

  const hoodTopY = ceilingTopY;
  const hoodBotY = 1.04;
  const hoodH = hoodTopY - hoodBotY;
  const hood = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.72, hoodH, 0.68)), mats.matteBlackHood);
  hood.position.y = (hoodTopY + hoodBotY) * 0.5;
  hood.castShadow = true;

  // 4-corner blackened steel L-angle verticals framing the 4-way open fire chamber
  for (const sx of [-0.82, 0.82]) {
    for (const sz of [-0.30, 0.30]) {
      const post = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.026, 0.76, 0.026)), mcm.blackenedSteel);
      post.position.set(sx, 0.66, sz);
      fpGroup.add(post);
    }
  }
  const fireInsert = new THREE.Group();
  fireInsert.position.set(0, 0.08, 0);
  buildHallWoodBurningStoveFirebox({
    stoveGroup: fireInsert,
    castIronMat: mats.matteBlackHood,
    namePrefix: 'stahlHearth',
    id: 'stahl-hearth-fire',
    label: 'Koenig 4-Sided Suspended Fireplace',
  });
  attachAudioEmitter(fpGroup, {
    id: 'stahl-fireplace-crackle',
    preset: 'woodStove',
    zoneId: 'stahlLivingDining',
    volume: 0.36,
    refDistance: 1.5,
    maxDistance: 10.0,
  });
  fpGroup.add(hearth, hood, fireInsert);
  root.add(fpGroup);

  // =========================================================================
  // 2. PUBLIC WING — LIVING & DINING CANTILEVER (`X in [0, 6.096], Z in [0, 12.192]`)
  // =========================================================================
  // High-pile warm cream/ivory woven shag wool area rug (`2.5 mm` thick, `0.5 mm` above slab)
  const livingRug = new THREE.Mesh(metricBox(4.15, 0.0025, 3.75, 0.75, 0.75), mcm.shagWool);
  livingRug.name = 'stahl.living.ivoryShagRug';
  livingRug.position.set(3.15, 0.00175, 9.55);
  livingRug.receiveShadow = true;
  tagCollisionRole(livingRug, 'ignore');
  root.add(livingRug);

  const rugTopY = 0.0036;

  // Tailored Florence Knoll tufted 3-seat bouclé sofa + perpendicular 2-seat lounge settee
  buildFlorenceKnollSofa(ctx, root, mcm, {
    name: 'stahl.living.knollSofaNorth',
    seats: 3,
    position: [3.10, rugTopY, 7.62],
    rotationY: 0,
    upholstery: 'ivory',
  });
  buildFlorenceKnollSofa(ctx, root, mcm, {
    name: 'stahl.living.knollSetteeEast',
    seats: 2,
    position: [4.96, rugTopY, 9.48],
    rotationY: -Math.PI * 0.5,
    upholstery: 'camel',
  });

  // Low honed Roman travertine & American walnut-slat coffee table w/ Arts & Architecture June 1960
  buildTravertineCoffeeTable(root, mcm, [3.12, rugTopY, 9.36]);

  // Sculpted Eames Lounge Chair & Ottoman (Herman Miller 670/671) in Santos Palisander rosewood
  buildEamesLoungeAndOttoman(ctx, root, mcm, {
    name: 'stahl.living.eamesLounge670',
    position: [1.38, rugTopY, 10.68],
    rotationY: Math.PI * 0.74,
  });

  // Pair of Van Keppel-Green saddle-leather sling lounge chairs (conversational symmetry + SE Shulman corner!)
  buildVkgSlingLoungeChair(ctx, root, mcm, {
    name: 'stahl.living.vkgSlingChairSE',
    position: [4.62, rugTopY, 11.16],
    rotationY: -Math.PI * 0.78,
  });
  buildVkgSlingLoungeChair(ctx, root, mcm, {
    name: 'stahl.living.vkgSlingChairWest',
    position: [1.52, rugTopY, 8.72],
    rotationY: Math.PI * 0.44,
  });

  // Architectural Pottery matte white cylinder planter at the SE glass apex + walnut/brass tripod floor lamp
  addArchitecturalPotteryPlanter(root, 5.54, 11.58, mcm.porcelainWhite, mcm.throwOlive);
  buildWalnutTripodFloorLamp(ctx, root, mcm, [4.76, rugTopY, 7.92]);

  // Sheer floor-to-ceiling architectural pinch-pleat open casement drapery stacks parked at steel column piers
  addSheerPinchPleatDraperyStack(root, mcm, {
    name: 'stahl.living.draperyEastMid',
    axis: 'z',
    center: [5.95, 6.48],
    widthM: 0.62,
    ceilingTopY,
    cutaway: eastCliffCut,
  });
  addSheerPinchPleatDraperyStack(root, mcm, {
    name: 'stahl.living.draperyEastSouth',
    axis: 'z',
    center: [5.95, 11.68],
    widthM: 0.62,
    ceilingTopY,
    cutaway: eastCliffCut,
  });
  addSheerPinchPleatDraperyStack(root, mcm, {
    name: 'stahl.living.draperySouthWest',
    axis: 'x',
    center: [0.58, 12.04],
    widthM: 0.64,
    ceilingTopY,
    cutaway: southCliffCut,
  });
  addSheerPinchPleatDraperyStack(root, mcm, {
    name: 'stahl.dining.draperyEastNorth',
    axis: 'z',
    center: [5.95, 0.56],
    widthM: 0.58,
    ceilingTopY,
    cutaway: eastCliffCut,
  });

  // Dining Zone: Saarinen Oval Pedestal Table + 6 Eames Fiberglass Chairs + Nelson Saucer Bubble Pendant + Knoll Credenza
  buildSaarinenDiningSetAndNelsonPendant(ctx, root, mcm, [3.55, 3.25], ceilingTopY);
  buildFlorenceKnollCredenza(root, mcm, [1.22, 0.0006, 0.44], 0);

  // =========================================================================
  // 3. PUBLIC WING — NORTH KITCHEN BAY (`X in [0, 6.096], Z in [-6.096, 0]`)
  // =========================================================================
  buildStahlKitchenBay(ctx, root, mcm);

  // =========================================================================
  // 4. PRIVATE WEST WING PARTITIONS, BEDROOMS & CENTRAL BATHROOM CORE
  // =========================================================================
  const partBaseY = 0.0006;
  const partTopY = ceilingTopY;
  const partH = partTopY - partBaseY;
  const partMidY = partBaseY + partH * 0.5;
  const bathCoreMinZ = Z0 + 0.163;
  const bathCoreMaxZ = -1.65 - 0.061;
  const bathCoreDepth = bathCoreMaxZ - bathCoreMinZ;
  const bathCoreCenterZ = (bathCoreMinZ + bathCoreMaxZ) * 0.5;

  const bathCoreSouth = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [X2 - 1.26, partBaseY], [X2 + 0.35, partBaseY], [X2 + 0.35, 2.12], [X2 + 1.15, 2.12],
        [X2 + 1.15, partBaseY], [X2 + 1.46, partBaseY], [X2 + 1.46, partTopY], [X2 - 1.26, partTopY],
      ],
      origin: [0, 0, -1.65],
      depthRange: [-0.06, 0.06],
    }),
    mcm.walnut
  );
  bathCoreSouth.name = 'stahl.partition.bathCoreSouth';

  const bathCoreEast = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.12, partH, bathCoreDepth)),
    mats.plasterOffWhite
  );
  bathCoreEast.name = 'stahl.partition.bathCoreEast';
  bathCoreEast.position.set(X2 + 1.4, partMidY, bathCoreCenterZ);

  const bathCoreWest = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.12, partH, bathCoreDepth)),
    mats.plasterOffWhite
  );
  bathCoreWest.name = 'stahl.partition.bathCoreWest';
  bathCoreWest.position.set(X2 - 1.2, partMidY, bathCoreCenterZ);

  const wingDivider = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [bathCoreMinZ, partBaseY], [-1.4, partBaseY], [-1.4, 2.25], [-0.35, 2.25],
        [-0.35, partBaseY], [Z1 - 0.052, partBaseY], [Z1 - 0.052, partTopY], [bathCoreMinZ, partTopY],
      ],
      origin: [X3, 0, 0],
      uAxis: [0, 0, 1],
      vAxis: [0, 1, 0],
      wAxis: [1, 0, 0],
      depthRange: [-0.06, 0.06],
    }),
    mcm.walnut
  );
  wingDivider.name = 'stahl.partition.wingDivider';
  root.add(bathCoreSouth, bathCoreEast, bathCoreWest, wingDivider);

  const bathDoor = new THREE.Mesh(metricBox(0.78, 2.1, 0.042, 0.85, 0.85), mcm.walnut);
  bathDoor.name = 'stahlMasterBathDoor';
  bathDoor.position.set(X2 + 0.75, 1.055, -1.65);
  root.add(bathDoor);
  registerHingedDoor(ctx, { parent: root, door: bathDoor, hingeOffset: [-0.39, -1.055, 0], axis: 'y', openAngle: 1.38 });

  // Master Bedroom, Bedroom 2, Breezeway Linen Closet & Central Bathroom Core
  buildMasterAndBedroom2Furnishings(ctx, root, mcm, cuts, ceilingTopY);
  buildBreezewayAndCentralBathCore(ctx, root, mcm, cuts, ceilingTopY);

  // =========================================================================
  // 5. ARCHITECTURAL LIGHTING CIRCUITS (STRICT 7 POINTLIGHTS IN INTERIORS)
  // =========================================================================
  addSpunAluminumCone(ctx, root, 'stahlLivingCones', 1.8, 8.2);
  addSpunAluminumCone(ctx, root, 'stahlLivingCones', 4.4, 8.2);
  addSpunAluminumCone(ctx, root, 'stahlLivingCones', 1.8, 10.6);
  addSpunAluminumCone(ctx, root, 'stahlLivingCones', 4.4, 10.6);
  attachCircuitPointLight(ctx, root, 'stahlLivingCones', [3.1, 2.4, 9.3], 0xffd29a, 3.2, 11.0);

  attachCircuitPointLight(ctx, root, 'stahlDiningPendant', [3.55, 1.82, 3.25], 0xffd6a2, 2.5, 8.5);
  ctx.addGlowPool('stahlDiningPendant' as never, 3.55, 0.008, 3.25, 1.6, 0.22);

  attachCircuitPointLight(ctx, root, 'stahlKitchenLuminous', [3.20, 2.15, -3.72], 0xfff0cc, 3.0, 9.0);
  ctx.addGlowPool('stahlKitchenLuminous' as never, 3.20, 0.008, -3.55, 2.1, 0.26);

  addSpunAluminumCone(ctx, root, 'stahlMasterCones', -2.35, -3.1);
  attachCircuitPointLight(ctx, root, 'stahlMasterCones', [-2.35, 2.4, -3.1], 0xffd39c, 2.4, 8.0);

  addSpunAluminumCone(ctx, root, 'stahlDenCones', -9.8, -3.1);
  attachCircuitPointLight(ctx, root, 'stahlDenCones', [-9.8, 2.4, -3.1], 0xffd39c, 2.4, 8.0);

  addSpunAluminumCone(ctx, root, 'stahlBathVanity', -5.95, -3.6, 0xfff0d4);
  attachCircuitPointLight(ctx, root, 'stahlBathVanity', [-5.95, 2.35, -3.6], 0xfff0d4, 2.1, 5.8);

  addSpunAluminumCone(ctx, root, 'stahlCarportGlobes', -15.2, -3.05, 0xffe4b8);
  attachCircuitPointLight(ctx, root, 'stahlCarportGlobes', [-15.2, 2.4, -3.05], 0xffe4b8, 2.4, 9.5);

  // =========================================================================
  // 6. MULTI-WAY WALL SWITCHES & ROTARY DIMMERS (100% CUTAWAY-TAGGED)
  // =========================================================================
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.entry', switchPa: 'plate-entry-breezeway', location: 'Kitchen entry X3/Z1', x: X3 + 0.08, y: 1.15, z: -0.22, facing: 'east', mountedInZoneId: 'stahlKitchen', parentGroup: root, gangs: [{ gang: 1, zoneId: 'stahlKitchen', label: 'Luminous Ceiling' }, { gang: 2, zoneId: 'stahlPoolTerrace', label: 'Pool 2-Way A' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.hearth', switchPa: 'plate-living-hearth', location: 'Living column X3/Z2', x: X3 + 0.08, y: 1.15, z: Z2 + 0.12, facing: 'east', mountedInZoneId: 'stahlLivingDining', parentGroup: root, cutawayWall: westPoolLivingCut, gangs: [{ gang: 1, zoneId: 'stahlPoolTerrace', label: 'Pool 2-Way B' }, { gang: 2, zoneId: 'stahlPoolTerrace', label: 'Soffit Wash' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.carport', switchPa: 'plate-carport-entry', location: 'Carport wall', x: X1 - 0.1, y: 1.15, z: -1.2, facing: 'west', mountedInZoneId: 'stahlCarport', parentGroup: root, cutawayWall: cuts.westCarportCut, gangs: [{ gang: 1, zoneId: 'stahlCarport', label: 'Carport' }, { gang: 2, zoneId: 'stahlBedroom2', label: 'Den 2-Way A' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.den', switchPa: 'plate-den-inner', location: 'Den inner wall', x: X2 - 1.28, y: 1.15, z: -2.1, facing: 'west', mountedInZoneId: 'stahlBedroom2', parentGroup: root, gangs: [{ gang: 1, zoneId: 'stahlBedroom2', label: 'Den 2-Way B' }, { gang: 2, zoneId: 'stahlBathCore', label: 'Bath Core' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.masterDoor', switchPa: 'plate-master-door', location: 'Master entry', x: X3 - 0.08, y: 1.15, z: -1.6, facing: 'west', mountedInZoneId: 'stahlMasterSuite', parentGroup: root, gangs: [{ gang: 1, zoneId: 'stahlMasterSuite', label: 'Master 3-Way Door' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.masterL', switchPa: 'plate-master-bed-left', location: 'Master bedside W', x: -3.35, y: 0.78, z: Z0 + 0.166, facing: 'south', mountedInZoneId: 'stahlMasterSuite', parentGroup: root, cutawayWall: cuts.northWoodsCut, gangs: [{ gang: 1, zoneId: 'stahlMasterSuite', label: 'Master 3-Way L' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.masterR', switchPa: 'plate-master-bed-right', location: 'Master bedside E', x: -1.35, y: 0.78, z: Z0 + 0.166, facing: 'south', mountedInZoneId: 'stahlMasterSuite', parentGroup: root, cutawayWall: cuts.northWoodsCut, gangs: [{ gang: 1, zoneId: 'stahlMasterSuite', label: 'Master 3-Way R' }] });

  for (const [id, zPos] of [['dimmer-stahl-dining', 1.8], ['dimmer-stahl-living', 6.45]] as const) {
    const knob = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.02, 0.022, 0.024, 18)), mats.anodizedAlum);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(X3 + 0.09, 1.15, zPos);
    knob.name = `stahl.dimmer.${id}`;
    knob.userData = { electricalDimmerId: id, zoneId: 'stahlLivingDining' };
    tagCutaway(knob, westPoolLivingCut);
    ctx.interactiveMeshes.push(knob);
    root.add(knob);
  }
}
