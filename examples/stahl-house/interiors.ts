import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  attachAudioEmitter,
  buildCorstonToggleSwitch,
  buildHallWoodBurningStoveFirebox,
  buildHollowCabinetCarcass,
  extrudePlanarSolidWithHoles,
  prepGeo,
  registerHingedDoor,
} from 'husjs/objects';
import {
  buildCoxDanicaBed,
  createSculptedCushionGeometry,
} from 'husjs/catalog/furniture';
import {
  buildArmstrongConcealedShowerSet,
  buildLefroyBrooksCharterhouseWc,
  buildLefroyBrooksLissaDoonWashstand,
  wallFacingToRotY,
} from 'husjs/catalog/sanitaryware';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import type { StahlMaterials } from './structure.ts';
import { CLEAR_CEILING_Y, X1, X2, X3, Z0, Z1, Z2 } from './terrain.ts';

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

export function buildStahlInteriors(
  ctx: SceneBuilderContext,
  root: THREE.Group,
  mats: StahlMaterials,
  cuts: { readonly northWoodsCut: CutawayWallDescriptor; readonly westCarportCut: CutawayWallDescriptor }
): void {
  // Koenig's Signature Double-Sided Suspended Sheet-Metal Fireplace (`X ~ 3.05, Z = Z2 = 6.096`)
  const fpGroup = new THREE.Group();
  fpGroup.name = 'stahl.living.fireplace';
  fpGroup.position.set(2.95, 0, Z2);

  // Raised cast-concrete hearth plinth
  const hearth = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(2.15, 0.26, 0.96)), mats.concreteSlab);
  hearth.position.y = 0.1306;
  hearth.castShadow = hearth.receiveShadow = true;

  // Suspended matte-black rectangular sheet-metal hood & rectangular flue dropping below roof soffit ribs
  const hoodTopY = CLEAR_CEILING_Y - 0.038;
  const hoodBotY = 1.022;
  const hoodH = hoodTopY - hoodBotY;
  const hood = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.72, hoodH, 0.68)), mats.matteBlackHood);
  hood.position.y = (hoodTopY + hoodBotY) * 0.5;
  hood.castShadow = true;
  // Twin corner tie rods framing the open 4-way/2-way fire opening (`0.26..1.02 m`)
  for (const sx of [-0.8, 0.8]) {
    for (const sz of [-0.28, 0.28]) {
      const rod = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.76, 10)), mats.matteBlackHood);
      rod.position.set(sx, 0.641, sz);
      fpGroup.add(rod);
    }
  }
  const fireInsert = new THREE.Group();
  fireInsert.position.set(0, 0.06, 0);
  buildHallWoodBurningStoveFirebox({
    stoveGroup: fireInsert,
    castIronMat: mats.matteBlackHood,
    namePrefix: 'stahlHearth',
    id: 'stahl-hearth-fire',
    label: 'Koenig Suspended Fireplace',
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

  // Julius Shulman 1960 Mid-Century Living & Dining Furnishings
  // Low wool-tweed L-sectional sofa + travertine coffee table + ivory shag rug
  const rug = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(3.9, 0.018, 3.5)),
    new THREE.MeshStandardMaterial({ color: 0xe6e1d5, roughness: 0.95 })
  );
  rug.position.set(3.2, 0.0096, 9.2);
  rug.receiveShadow = true;
  root.add(rug);

  const tweedMat = new THREE.MeshStandardMaterial({ color: 0xb7ab95, roughness: 0.88 });
  const sectional = new THREE.Group();
  sectional.name = 'stahl.living.sectional';
  const mainSeat = new THREE.Mesh(prepGeo(createSculptedCushionGeometry(2.65, 0.22, 0.86, 16, 8, 12, 0.45, 'standard')), tweedMat);
  mainSeat.position.set(0, 0.31, 0);
  const mainBack = new THREE.Mesh(prepGeo(createSculptedCushionGeometry(2.65, 0.36, 0.18, 16, 8, 8, 0.45, 'standard')), tweedMat);
  mainBack.position.set(0, 0.56, -0.34);
  const returnSeat = new THREE.Mesh(prepGeo(createSculptedCushionGeometry(0.86, 0.22, 1.55, 12, 8, 14, 0.45, 'standard')), tweedMat);
  returnSeat.position.set(-0.89, 0.31, 1.2);
  sectional.add(mainSeat, mainBack, returnSeat);
  sectional.position.set(3.05, 0, 8.25);
  root.add(sectional);

  // Mid-century walnut & travertine low coffee table
  const coffeeTop = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.35, 0.032, 0.72)), mats.parchmentFormica);
  coffeeTop.position.set(3.25, 0.36, 9.65);
  coffeeTop.castShadow = true;
  root.add(coffeeTop);

  // Dining bay (`Z1..Z2`): White Saarinen/Burke pedestal round table + 4 sculpted shell chairs
  const diningGroup = new THREE.Group();
  diningGroup.name = 'stahl.dining.pedestalSet';
  diningGroup.position.set(3.1, 0, 3.25);
  const pedTop = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.68, 0.68, 0.028, 28)), mats.parchmentFormica);
  pedTop.position.y = 0.74;
  pedTop.castShadow = true;
  const pedStem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.06, 0.24, 0.7244, 20)), mats.parchmentFormica);
  pedStem.position.y = 0.3628;
  diningGroup.add(pedTop, pedStem);

  const shellChairMat = new THREE.MeshStandardMaterial({ color: 0xd96b38, roughness: 0.52 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const ch = new THREE.Group();
    ch.position.set(Math.cos(a) * 0.92, 0, Math.sin(a) * 0.92);
    ch.rotation.y = -a - Math.PI / 2;
    const seat = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.46, 0.04, 0.44)), shellChairMat);
    seat.position.y = 0.44;
    const back = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.44, 0.36, 0.04)), shellChairMat);
    back.position.set(0, 0.641, -0.2);
    const leg = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.03, 0.16, 0.4184, 14)), mats.anodizedAlum);
    leg.position.y = 0.2098;
    ch.add(seat, back, leg);
    diningGroup.add(ch);
  }
  root.add(diningGroup);

  // North Kitchen Bay (`X3..X4, Z0..Z1`): American black walnut cabinetry + parchment Formica counters + dropped luminous ceiling
  const kitchenGroup = new THREE.Group();
  kitchenGroup.name = 'stahl.kitchen.joinery';
  buildHollowCabinetCarcass(kitchenGroup, 3.05, 0.45, Z0 + 0.5, 4.4, 0.9, 0.65, '+z', mats.walnutWood, {
    plinthH: 0.1,
    dividers: 4,
    shelfCount: 1,
    interiorStyle: 'oak',
    populateItems: true,
  });
  const northCounter = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(4.46, 0.038, 0.68)), mats.parchmentFormica);
  northCounter.position.set(3.05, 0.920, Z0 + 0.5);
  northCounter.castShadow = true;

  // Walnut peninsula / prep island with parchment Formica bar counter & chrome stools
  buildHollowCabinetCarcass(kitchenGroup, 3.05, 0.45, -1.85, 3.2, 0.9, 0.85, '+z', mats.walnutWood, {
    plinthH: 0.1,
    dividers: 3,
    shelfCount: 1,
    interiorStyle: 'oak',
    populateItems: true,
  });
  const islandTop = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(3.32, 0.04, 1.05)), mats.parchmentFormica);
  islandTop.position.set(3.05, 0.921, -1.78);
  islandTop.castShadow = true;
  kitchenGroup.add(northCounter, islandTop);

  // Dropped translucent luminous ceiling panel (`2.36 m` soffit) over the walnut prep island!
  const lumMat = new THREE.MeshStandardMaterial({
    color: 0xfffdf6,
    emissive: new THREE.Color(0xfff1d0),
    emissiveIntensity: 1.45,
    roughness: 0.3,
  });
  const lumFrame = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(3.42, 0.09, 1.82)), mats.walnutWood);
  lumFrame.position.set(3.05, 2.42, -2.55);
  const lumDiffuser = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(3.26, 0.025, 1.66)), lumMat);
  lumDiffuser.name = 'stahl.kitchen.luminousPanel';
  lumDiffuser.position.set(3.05, 2.3615, -2.55);
  kitchenGroup.add(lumFrame, lumDiffuser);
  root.add(kitchenGroup);

  const lumGroup = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlKitchenLuminous;
  if (lumGroup) lumGroup.emissives.push(lumDiffuser.material as THREE.MeshStandardMaterial);
  attachCircuitPointLight(ctx, root, 'stahlKitchenLuminous', [3.05, 2.15, -2.55], 0xfff0cc, 3.0, 9.0);
  ctx.addGlowPool('stahlKitchenLuminous' as never, 3.05, 0.008, -2.55, 1.9, 0.25);

  // Private North/West Wing (`X1..X3, Z0..Z1`): Zero-corridor Central Bath/Dressing Core + Master Suite + Bedroom 2 / Den
  const partBaseY = 0.0006;
  const partTopY = CLEAR_CEILING_Y - 0.038;
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
    mats.walnutWood
  );
  const bathCoreEast = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.12, partH, bathCoreDepth)),
    mats.plasterOffWhite
  );
  bathCoreEast.position.set(X2 + 1.4, partMidY, bathCoreCenterZ);
  const bathCoreWest = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.12, partH, bathCoreDepth)),
    mats.plasterOffWhite
  );
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
    mats.walnutWood
  );
  root.add(bathCoreSouth, bathCoreEast, bathCoreWest, wingDivider);

  const bathDoor = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.78, 2.1, 0.042)), mats.walnutWood);
  bathDoor.name = 'stahlMasterBathDoor';
  bathDoor.position.set(X2 + 0.75, 1.055, -1.65);
  root.add(bathDoor);
  registerHingedDoor(ctx, { parent: root, door: bathDoor, hingeOffset: [-0.39, -1.055, 0], axis: 'y', openAngle: 1.38 });

  // Master Suite (`X2+1.4..X3`) & Bedroom 2 / Den (`X1..X2-1.2`) beds + sanitaryware
  buildCoxDanicaBed(root, { name: 'stahl.master.bed', zone: 'stahlMasterSuite', position: [-2.35, 0, Z0 + 0.18], rotationY: -Math.PI / 2, size: 'ukKing' });
  buildCoxDanicaBed(root, { name: 'stahl.den.daybed', zone: 'stahlBedroom2', position: [X1 + 0.16, 0, -3.2], rotationY: 0, size: 'ukDouble' });

  const wc = buildLefroyBrooksCharterhouseWc({ namePrefix: 'stahl.bath.wc', finish: 'PF', variant: 'closeCoupled' });
  wc.position.set(X2 - 0.55, 0, Z0 + 0.18);
  wc.rotation.y = wallFacingToRotY('south');
  const vanity = buildLefroyBrooksLissaDoonWashstand({ namePrefix: 'stahl.bath.vanity', finish: 'PF' });
  vanity.position.set(X2 + 0.35, 0, Z0 + 0.18);
  vanity.rotation.y = wallFacingToRotY('south');
  const shower = buildArmstrongConcealedShowerSet({ namePrefix: 'stahl.bath.shower', finish: 'PF' });
  shower.position.set(X2 + 1.3, 0, -3.2);
  shower.rotation.y = wallFacingToRotY('west');
  root.add(wc, vanity, shower);

  // Spun-aluminum monopoint downlights, dining globe pendant & conventional multi-way switches/dimmers
  addSpunAluminumCone(ctx, root, 'stahlLivingCones', 1.8, 8.2);
  addSpunAluminumCone(ctx, root, 'stahlLivingCones', 4.4, 8.2);
  addSpunAluminumCone(ctx, root, 'stahlLivingCones', 1.8, 10.6);
  addSpunAluminumCone(ctx, root, 'stahlLivingCones', 4.4, 10.6);
  attachCircuitPointLight(ctx, root, 'stahlLivingCones', [3.1, 2.4, 9.3], 0xffd29a, 3.2, 11.0);

  // Dining globe pendant
  const dinGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlDiningPendant;
  const globeMat = new THREE.MeshStandardMaterial({ color: 0xfff9ee, emissive: new THREE.Color(0xffd6a2), emissiveIntensity: 1.4, roughness: 0.35 });
  const globe = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.19, 20, 14)), globeMat);
  globe.position.set(3.1, 1.88, 3.25);
  const cordTopY = CLEAR_CEILING_Y - 0.038;
  const cord = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.005, 0.005, cordTopY - 1.88, 8)), mats.matteBlackHood);
  cord.position.set(3.1, (cordTopY + 1.88) * 0.5, 3.25);
  root.add(globe, cord);
  if (dinGrp) dinGrp.emissives.push(globeMat);
  attachCircuitPointLight(ctx, root, 'stahlDiningPendant', [3.1, 1.78, 3.25], 0xffd6a2, 2.5, 8.5);

  addSpunAluminumCone(ctx, root, 'stahlMasterCones', -2.35, -3.1);
  attachCircuitPointLight(ctx, root, 'stahlMasterCones', [-2.35, 2.4, -3.1], 0xffd39c, 2.4, 8.0);

  addSpunAluminumCone(ctx, root, 'stahlDenCones', -9.6, -3.1);
  attachCircuitPointLight(ctx, root, 'stahlDenCones', [-9.6, 2.4, -3.1], 0xffd39c, 2.4, 8.0);

  addSpunAluminumCone(ctx, root, 'stahlBathVanity', X2 + 0.2, -3.5, 0xfff0d4);
  attachCircuitPointLight(ctx, root, 'stahlBathVanity', [X2 + 0.2, 2.35, -3.5], 0xfff0d4, 2.0, 5.5);

  addSpunAluminumCone(ctx, root, 'stahlCarportGlobes', -15.2, -3.05, 0xffe4b8);
  attachCircuitPointLight(ctx, root, 'stahlCarportGlobes', [-15.2, 2.4, -3.05], 0xffe4b8, 2.4, 9.5);

  // Wall switches & rotary dimmers
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.entry', switchPa: 'plate-entry-breezeway', location: 'Kitchen entry X3/Z1', x: X3 + 0.08, y: 1.15, z: -0.22, facing: 'east', mountedInZoneId: 'stahlKitchen', parentGroup: root, gangs: [{ gang: 1, zoneId: 'stahlKitchen', label: 'Luminous Ceiling' }, { gang: 2, zoneId: 'stahlPoolTerrace', label: 'Pool 2-Way A' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.hearth', switchPa: 'plate-living-hearth', location: 'Living column X3/Z2', x: X3 + 0.08, y: 1.15, z: Z2 + 0.12, facing: 'east', mountedInZoneId: 'stahlLivingDining', parentGroup: root, gangs: [{ gang: 1, zoneId: 'stahlPoolTerrace', label: 'Pool 2-Way B' }, { gang: 2, zoneId: 'stahlPoolTerrace', label: 'Soffit Wash' }] });
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
    ctx.interactiveMeshes.push(knob);
    root.add(knob);
  }
}
