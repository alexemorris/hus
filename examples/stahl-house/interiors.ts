import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  attachAssetMetadata,
  attachAudioEmitter,
  buildCorstonToggleSwitch,
  buildHallWoodBurningStoveFirebox,
  prepGeo,
  registerHingedDoor,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import { buildBreezewayAndCentralBathCore, buildStahlKitchenBay } from './kitchen-and-bath.ts';
import { buildFlorenceKnollCredenza, buildMasterAndBedroom2Furnishings } from './mcm-bedrooms.ts';
import {
  addSheerPinchPleatDraperyStack,
  buildEamesLoungeAndOttoman,
  buildFlorenceKnollSofa,
  buildSaarinenDiningSetAndNelsonPendant,
  buildTravertineCoffeeTable,
  buildVkgSlingLoungeChair,
  buildWalnutTripodFloorLamp,
} from './mcm-furniture.ts';
import { getMcmMaterials, type McmMaterials } from './mcm-materials.ts';
import {
  bevelledBox,
  buildAgaveAttenuataRosetteGeo,
  buildArchitecturalPotteryPlanterGeo,
} from './sculpted-geometry.ts';
import type { StahlMaterials } from './structure.ts';
import { CLEAR_CEILING_Y, X1, X2, X3, X4, Z0, Z1, Z2, Z3 } from './terrain.ts';

let cachedPrescoliteGeos: {
  readonly canopy: THREE.BufferGeometry;
  readonly shade: THREE.BufferGeometry;
  readonly bulb: THREE.BufferGeometry;
} | null = null;

function getPrescoliteGeos() {
  if (!cachedPrescoliteGeos) {
    // 52-seg spun-aluminum Prescolite cone profile with rolled anti-glare aperture rim
    const lathe = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.084, -0.168), new THREE.Vector2(0.088, -0.165), new THREE.Vector2(0.085, -0.156),
        new THREE.Vector2(0.064, -0.095), new THREE.Vector2(0.044, -0.032), new THREE.Vector2(0.042, 0),
        new THREE.Vector2(0.039, 0), new THREE.Vector2(0.041, -0.032), new THREE.Vector2(0.061, -0.095),
        new THREE.Vector2(0.082, -0.158), new THREE.Vector2(0.084, -0.168),
      ],
      52
    );
    lathe.computeVertexNormals();
    cachedPrescoliteGeos = {
      canopy: prepGeo(new THREE.CylinderGeometry(0.056, 0.062, 0.01, 52)),
      shade: prepGeo(lathe),
      bulb: prepGeo(new THREE.SphereGeometry(0.04, 48, 28)),
    };
  }
  return cachedPrescoliteGeos;
}

function addSpunAluminumCone(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  circuitId: string,
  x: number,
  z: number,
  hex = 0xffd59e
): void {
  const grp = (ctx.lightGroups as Record<string, LightCircuitGroup>)[circuitId];
  const geos = getPrescoliteGeos();
  const soffitY = CLEAR_CEILING_Y - 0.038;

  const fixture = new THREE.Group();
  fixture.position.set(x, soffitY - 0.001, z);

  const canopy = new THREE.Mesh(geos.canopy, mcm.blackenedSteel);
  canopy.position.y = -0.005;
  const shade = new THREE.Mesh(geos.shade, mcm.dieCastAlum);
  shade.position.y = -0.011;

  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff8eb,
    emissive: new THREE.Color(hex),
    emissiveIntensity: 1.5,
    roughness: 0.22,
  });
  const bulb = new THREE.Mesh(geos.bulb, bulbMat);
  bulb.position.y = -0.108;

  fixture.add(canopy, shade, bulb);
  parent.add(fixture);
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

/**
 * Architectural Pottery MP-17 unglazed stoneware planter (`56` radial segs) on a bevelled
 * American walnut cross-stand with brass ferrules and a 26-frond *Agave attenuata* rosette.
 */
function addArchitecturalPotteryPlanter(parent: THREE.Object3D, x: number, z: number, mcm: McmMaterials): void {
  const g = new THREE.Group();
  g.name = 'stahl.living.architecturalPotteryPlanter';
  g.position.set(x, 0.001, z);

  const legGeo = bevelledBox(0.024, 0.292, 0.024, 0.004, 4, 0.5, 0.5);
  const ferruleGeo = prepGeo(new THREE.CylinderGeometry(0.012, 0.011, 0.014, 24));
  for (const [lx, lz] of [[-0.202, 0], [0.202, 0], [0, -0.202], [0, 0.202]] as const) {
    const ferrule = new THREE.Mesh(ferruleGeo, mcm.satinBrass);
    ferrule.position.set(lx, 0.007, lz);
    const leg = new THREE.Mesh(legGeo, mcm.walnut);
    leg.position.set(lx, 0.161, lz);
    leg.castShadow = true;
    g.add(ferrule, leg);
  }
  const crossX = new THREE.Mesh(bevelledBox(0.378, 0.026, 0.022, 0.004, 4, 0.5, 0.5), mcm.walnut);
  crossX.position.set(0, 0.11, 0);
  g.add(crossX);
  const halfCrossZGeo = bevelledBox(0.022, 0.026, 0.177, 0.004, 4, 0.5, 0.5);
  for (const sz of [-0.1005, 0.1005]) {
    const cz = new THREE.Mesh(halfCrossZGeo, mcm.walnut);
    cz.position.set(0, 0.11, sz);
    g.add(cz);
  }

  const potY = 0.1245;
  const potH = 0.34;
  const pot = new THREE.Mesh(buildArchitecturalPotteryPlanterGeo(0.184, 0.168, potH, 0.016, 56), mcm.stonewareWhite);
  pot.position.y = potY;
  pot.castShadow = pot.receiveShadow = true;

  const soil = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.164, 0.164, 0.016, 48)), mcm.formicaCharcoal);
  soil.position.y = potY + potH * 0.78 + 0.009;

  const agaveMat = new THREE.MeshStandardMaterial({ color: 0x627e4c, roughness: 0.52, metalness: 0.02 });
  const agave = new THREE.Mesh(buildAgaveAttenuataRosetteGeo(26, 0.78), agaveMat);
  agave.position.y = potY + potH * 0.78 + 0.018;
  agave.castShadow = true;

  g.add(pot, soil, agave);
  attachAssetMetadata(g, {
    name: 'Architectural Pottery Model MP-17 Matte White Cylinder Planter & Stand',
    brand: 'Architectural Pottery (Manhattan Beach, CA)',
    collection: 'LaGardo Tackett / John Follis Case Study Series',
    sku: 'AP-MP17-WHT',
    finish: 'Matte Unglazed White Stoneware, Bevelled American Walnut Cross-Stand & Foxtail Agave',
    category: 'decor',
    dimensionsMm: [410, 410, 820],
  });
  parent.add(g);
}

/**
 * Adds a bevelled partition wall segment with recessed modern shadow-gap base & ceiling reveals
 * (`>= 1.2 mm` clear of floor & ceiling, `>= 1.0 mm` clear between reveal & wall panel).
 */
function addShadowGapWallPier(
  parent: THREE.Object3D,
  wallMat: THREE.Material,
  revealMat: THREE.Material,
  x: number,
  z: number,
  w: number,
  d: number,
  ceilingTopY: number
): void {
  const floorClear = 0.0012;
  const baseH = 0.018;
  const topRevealH = 0.012;
  const wallBotY = floorClear + baseH + 0.001;
  const wallTopY = ceilingTopY - floorClear - topRevealH - 0.001;
  const wallH = wallTopY - wallBotY;
  const rw = Math.max(0.02, w - (w > d ? 0.002 : 0.014));
  const rd = Math.max(0.02, d - (d > w ? 0.002 : 0.014));

  const baseTrim = new THREE.Mesh(bevelledBox(rw, baseH, rd, 0.002, 3), revealMat);
  baseTrim.position.set(x, floorClear + baseH * 0.5, z);

  const panel = new THREE.Mesh(bevelledBox(w, wallH, d, 0.004, 4, 0.95, 0.95), wallMat);
  panel.position.set(x, wallBotY + wallH * 0.5, z);
  panel.castShadow = panel.receiveShadow = true;

  const topTrim = new THREE.Mesh(bevelledBox(rw, topRevealH, rd, 0.002, 3), revealMat);
  topTrim.position.set(x, ceilingTopY - floorClear - topRevealH * 0.5, z);

  parent.add(baseTrim, panel, topTrim);
}

function addShadowGapDoorHeader(
  parent: THREE.Object3D,
  wallMat: THREE.Material,
  revealMat: THREE.Material,
  x: number,
  z: number,
  w: number,
  d: number,
  lintelBotY: number,
  ceilingTopY: number
): void {
  const floorClear = 0.0012;
  const topRevealH = 0.012;
  const headerTopY = ceilingTopY - floorClear - topRevealH - 0.001;
  const headerH = headerTopY - lintelBotY;
  const rw = Math.max(0.02, w - (w > d ? 0.002 : 0.014));
  const rd = Math.max(0.02, d - (d > w ? 0.002 : 0.014));

  const header = new THREE.Mesh(bevelledBox(w, headerH, d, 0.004, 4, 0.95, 0.95), wallMat);
  header.position.set(x, lintelBotY + headerH * 0.5, z);
  header.castShadow = header.receiveShadow = true;

  const topTrim = new THREE.Mesh(bevelledBox(rw, topRevealH, rd, 0.002, 3), revealMat);
  topTrim.position.set(x, ceilingTopY - floorClear - topRevealH * 0.5, z);

  parent.add(header, topTrim);
}

export function buildStahlInteriors(
  ctx: SceneBuilderContext,
  root: THREE.Group,
  mats: StahlMaterials,
  cuts: { readonly northWoodsCut: CutawayWallDescriptor; readonly westCarportCut: CutawayWallDescriptor }
): void {
  const mcm = getMcmMaterials();
  const ceilingTopY = CLEAR_CEILING_Y - 0.038;

  const eastCliffCut: CutawayWallDescriptor = { axis: 'x', coord: X4, minSpan: Z0, maxSpan: Z3, floor: 'ground', outwardSide: 'east' };
  const southCliffCut: CutawayWallDescriptor = { axis: 'z', coord: Z3, minSpan: X3, maxSpan: X4, floor: 'ground', outwardSide: 'south' };
  const westPoolLivingCut: CutawayWallDescriptor = { axis: 'x', coord: X3, minSpan: Z1, maxSpan: Z3, floor: 'ground', outwardSide: 'west' };

  // Legacy fireplace anchor (structure.ts builds authoritative stahl.fireplace.assembly; keep audio & firebox bindings intact)
  const fpGroup = new THREE.Group();
  fpGroup.name = 'stahl.living.fireplace';
  fpGroup.position.set(2.95, 0, Z2);

  const hearth = new THREE.Mesh(bevelledBox(2.15, 0.28, 0.96, 0.006, 4, 0.9, 0.9), mcm.travertine);
  hearth.position.y = 0.141;
  hearth.castShadow = hearth.receiveShadow = true;

  const hoodBotY = 1.04;
  const hoodH = ceilingTopY - 0.0012 - hoodBotY;
  const hood = new THREE.Mesh(bevelledBox(1.72, hoodH, 0.68, 0.005, 4), mats.matteBlackHood);
  hood.position.y = hoodBotY + hoodH * 0.5;
  hood.castShadow = true;

  const postGeo = bevelledBox(0.026, 0.756, 0.026, 0.003, 3);
  for (const sx of [-0.82, 0.82]) {
    for (const sz of [-0.3, 0.3]) {
      const post = new THREE.Mesh(postGeo, mcm.blackenedSteel);
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

  // Public Wing — Living & Dining Cantilever (`X in [0, 6.096], Z in [0, 12.192]`)
  const livingRug = new THREE.Mesh(bevelledBox(4.15, 0.003, 3.75, 0.0012, 2, 0.75, 0.75), mcm.shagWool);
  livingRug.name = 'stahl.living.ivoryShagRug';
  livingRug.position.set(3.15, 0.0023, 9.55);
  livingRug.receiveShadow = true;
  tagCollisionRole(livingRug, 'ignore');
  root.add(livingRug);

  const rugTopY = 0.0046;
  buildFlorenceKnollSofa(ctx, root, mcm, { name: 'stahl.living.knollSofaNorth', seats: 3, position: [3.1, rugTopY, 7.62], rotationY: 0, upholstery: 'ivory' });
  buildFlorenceKnollSofa(ctx, root, mcm, { name: 'stahl.living.knollSetteeEast', seats: 2, position: [4.96, rugTopY, 9.48], rotationY: -Math.PI * 0.5, upholstery: 'camel' });
  buildTravertineCoffeeTable(root, mcm, [3.12, rugTopY, 9.36]);
  buildEamesLoungeAndOttoman(ctx, root, mcm, { name: 'stahl.living.eamesLounge670', position: [1.38, rugTopY, 10.68], rotationY: Math.PI * 0.74 });
  buildVkgSlingLoungeChair(ctx, root, mcm, { name: 'stahl.living.vkgSlingChairSE', position: [4.62, rugTopY, 11.16], rotationY: -Math.PI * 0.78 });
  buildVkgSlingLoungeChair(ctx, root, mcm, { name: 'stahl.living.vkgSlingChairWest', position: [1.52, rugTopY, 8.72], rotationY: Math.PI * 0.44 });

  addArchitecturalPotteryPlanter(root, 5.54, 11.58, mcm);
  buildWalnutTripodFloorLamp(ctx, root, mcm, [4.76, rugTopY, 7.92]);

  addSheerPinchPleatDraperyStack(root, mcm, { name: 'stahl.living.draperyEastMid', axis: 'z', center: [5.95, 6.48], widthM: 0.62, ceilingTopY, cutaway: eastCliffCut });
  addSheerPinchPleatDraperyStack(root, mcm, { name: 'stahl.living.draperyEastSouth', axis: 'z', center: [5.95, 11.68], widthM: 0.62, ceilingTopY, cutaway: eastCliffCut });
  addSheerPinchPleatDraperyStack(root, mcm, { name: 'stahl.living.draperySouthWest', axis: 'x', center: [0.58, 12.04], widthM: 0.64, ceilingTopY, cutaway: southCliffCut });
  addSheerPinchPleatDraperyStack(root, mcm, { name: 'stahl.dining.draperyEastNorth', axis: 'z', center: [5.95, 0.56], widthM: 0.58, ceilingTopY, cutaway: eastCliffCut });

  buildSaarinenDiningSetAndNelsonPendant(ctx, root, mcm, [3.55, 3.25], ceilingTopY);
  buildFlorenceKnollCredenza(root, mcm, [1.22, 0.001, 0.44], 0);

  // North Kitchen Bay
  buildStahlKitchenBay(ctx, root, mcm);

  // Private West Wing Bevelled Walnut/Plaster Partitions & Modern Shadow-Gap Base Trims
  const bathCoreMinZ = Z0 + 0.163;
  const bathCoreMaxZ = -1.65 - 0.061;
  const bathCoreDepth = bathCoreMaxZ - bathCoreMinZ;
  const bathCoreCenterZ = (bathCoreMinZ + bathCoreMaxZ) * 0.5;

  const bathCoreSouth = new THREE.Group();
  bathCoreSouth.name = 'stahl.partition.bathCoreSouth';
  addShadowGapWallPier(bathCoreSouth, mcm.walnut, mcm.blackenedSteel, (X2 - 1.26 + X2 + 0.35) * 0.5, -1.65, 1.61, 0.12, ceilingTopY);
  addShadowGapWallPier(bathCoreSouth, mcm.walnut, mcm.blackenedSteel, (X2 + 1.15 + X2 + 1.46) * 0.5, -1.65, 0.31, 0.12, ceilingTopY);
  addShadowGapDoorHeader(bathCoreSouth, mcm.walnut, mcm.blackenedSteel, X2 + 0.75, -1.65, 0.798, 0.12, 2.12, ceilingTopY);

  const bathCoreEast = new THREE.Group();
  bathCoreEast.name = 'stahl.partition.bathCoreEast';
  addShadowGapWallPier(bathCoreEast, mats.plasterOffWhite, mcm.blackenedSteel, X2 + 1.4, bathCoreCenterZ, 0.12, bathCoreDepth, ceilingTopY);

  const bathCoreWest = new THREE.Group();
  bathCoreWest.name = 'stahl.partition.bathCoreWest';
  addShadowGapWallPier(bathCoreWest, mats.plasterOffWhite, mcm.blackenedSteel, X2 - 1.2, bathCoreCenterZ, 0.12, bathCoreDepth, ceilingTopY);

  const wingDivider = new THREE.Group();
  wingDivider.name = 'stahl.partition.wingDivider';
  const northDivEnd = -1.4;
  const southDivStart = -0.35;
  const southDivEnd = Z1 - 0.052;
  addShadowGapWallPier(wingDivider, mcm.walnut, mcm.blackenedSteel, X3, (bathCoreMinZ + northDivEnd) * 0.5, 0.12, northDivEnd - bathCoreMinZ, ceilingTopY);
  addShadowGapWallPier(wingDivider, mcm.walnut, mcm.blackenedSteel, X3, (southDivStart + southDivEnd) * 0.5, 0.12, southDivEnd - southDivStart, ceilingTopY);
  addShadowGapDoorHeader(wingDivider, mcm.walnut, mcm.blackenedSteel, X3, (northDivEnd + southDivStart) * 0.5, 0.12, southDivStart - northDivEnd - 0.002, 2.25, ceilingTopY);

  root.add(bathCoreSouth, bathCoreEast, bathCoreWest, wingDivider);

  // Bevelled American walnut bathroom door (`>= 5 mm` floor & jamb clearances) + 24-seg chrome levers
  const bathDoor = new THREE.Mesh(bevelledBox(0.78, 2.1, 0.042, 0.004, 4, 0.85, 0.85), mcm.walnut);
  bathDoor.name = 'stahlMasterBathDoor';
  bathDoor.position.set(X2 + 0.75, 1.055, -1.65);
  bathDoor.castShadow = bathDoor.receiveShadow = true;
  const roseGeo = prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.005, 24));
  const gripGeo = prepGeo(new THREE.CylinderGeometry(0.0065, 0.0075, 0.11, 24));
  for (const sz of [-1, 1]) {
    const rose = new THREE.Mesh(roseGeo, mcm.polishedChrome);
    rose.rotation.x = Math.PI * 0.5;
    rose.position.set(0.32, -0.055, sz * 0.0245);
    const grip = new THREE.Mesh(gripGeo, mcm.polishedChrome);
    grip.rotation.z = Math.PI * 0.5;
    grip.position.set(0.28, -0.055, sz * 0.046);
    bathDoor.add(rose, grip);
  }
  root.add(bathDoor);
  registerHingedDoor(ctx, { parent: root, door: bathDoor, hingeOffset: [-0.39, -1.055, 0], axis: 'y', openAngle: 1.38 });

  // Master Bedroom, Bedroom 2, Breezeway Linen Closet & Central Bathroom Core
  buildMasterAndBedroom2Furnishings(ctx, root, mcm, cuts, ceilingTopY);
  buildBreezewayAndCentralBathCore(ctx, root, mcm, cuts, ceilingTopY);

  // Architectural Lighting Circuits (STRICT 7 PointLights preserved!)
  addSpunAluminumCone(ctx, root, mcm, 'stahlLivingCones', 1.8, 8.2);
  addSpunAluminumCone(ctx, root, mcm, 'stahlLivingCones', 4.4, 8.2);
  addSpunAluminumCone(ctx, root, mcm, 'stahlLivingCones', 1.8, 10.6);
  addSpunAluminumCone(ctx, root, mcm, 'stahlLivingCones', 4.4, 10.6);
  attachCircuitPointLight(ctx, root, 'stahlLivingCones', [3.1, 2.4, 9.3], 0xffd29a, 3.2, 11.0);

  attachCircuitPointLight(ctx, root, 'stahlDiningPendant', [3.55, 1.82, 3.25], 0xffd6a2, 2.5, 8.5);
  ctx.addGlowPool('stahlDiningPendant' as never, 3.55, 0.008, 3.25, 1.6, 0.22);

  attachCircuitPointLight(ctx, root, 'stahlKitchenLuminous', [3.2, 2.15, -3.72], 0xfff0cc, 3.0, 9.0);
  ctx.addGlowPool('stahlKitchenLuminous' as never, 3.2, 0.008, -3.55, 2.1, 0.26);

  addSpunAluminumCone(ctx, root, mcm, 'stahlMasterCones', -2.35, -3.1);
  attachCircuitPointLight(ctx, root, 'stahlMasterCones', [-2.35, 2.4, -3.1], 0xffd39c, 2.4, 8.0);

  addSpunAluminumCone(ctx, root, mcm, 'stahlDenCones', -9.8, -3.1);
  attachCircuitPointLight(ctx, root, 'stahlDenCones', [-9.8, 2.4, -3.1], 0xffd39c, 2.4, 8.0);

  addSpunAluminumCone(ctx, root, mcm, 'stahlBathVanity', -5.95, -3.6, 0xfff0d4);
  attachCircuitPointLight(ctx, root, 'stahlBathVanity', [-5.95, 2.35, -3.6], 0xfff0d4, 2.1, 5.8);

  addSpunAluminumCone(ctx, root, mcm, 'stahlCarportGlobes', -15.2, -3.05, 0xffe4b8);
  attachCircuitPointLight(ctx, root, 'stahlCarportGlobes', [-15.2, 2.4, -3.05], 0xffe4b8, 2.4, 9.5);

  // Multi-way Wall Switches & Rotary Dimmers (100% Cutaway-Tagged)
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.entry', switchPa: 'plate-entry-breezeway', location: 'Kitchen entry X3/Z1', x: X3 + 0.08, y: 1.15, z: -0.22, facing: 'east', mountedInZoneId: 'stahlKitchen', parentGroup: root, gangs: [{ gang: 1, zoneId: 'stahlKitchen', label: 'Luminous Ceiling' }, { gang: 2, zoneId: 'stahlPoolTerrace', label: 'Pool 2-Way A' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.hearth', switchPa: 'plate-living-hearth', location: 'Living column X3/Z2', x: X3 + 0.08, y: 1.15, z: Z2 + 0.12, facing: 'east', mountedInZoneId: 'stahlLivingDining', parentGroup: root, cutawayWall: westPoolLivingCut, gangs: [{ gang: 1, zoneId: 'stahlPoolTerrace', label: 'Pool 2-Way B' }, { gang: 2, zoneId: 'stahlPoolTerrace', label: 'Soffit Wash' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.carport', switchPa: 'plate-carport-entry', location: 'Carport wall', x: X1 - 0.1, y: 1.15, z: -1.2, facing: 'west', mountedInZoneId: 'stahlCarport', parentGroup: root, cutawayWall: cuts.westCarportCut, gangs: [{ gang: 1, zoneId: 'stahlCarport', label: 'Carport' }, { gang: 2, zoneId: 'stahlBedroom2', label: 'Den 2-Way A' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.den', switchPa: 'plate-den-inner', location: 'Den inner wall', x: X2 - 1.28, y: 1.15, z: -2.1, facing: 'west', mountedInZoneId: 'stahlBedroom2', parentGroup: root, gangs: [{ gang: 1, zoneId: 'stahlBedroom2', label: 'Den 2-Way B' }, { gang: 2, zoneId: 'stahlBathCore', label: 'Bath Core' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.masterDoor', switchPa: 'plate-master-door', location: 'Master entry', x: X3 - 0.08, y: 1.15, z: -1.6, facing: 'west', mountedInZoneId: 'stahlMasterSuite', parentGroup: root, gangs: [{ gang: 1, zoneId: 'stahlMasterSuite', label: 'Master 3-Way Door' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.masterL', switchPa: 'plate-master-bed-left', location: 'Master bedside W', x: -3.35, y: 0.78, z: Z0 + 0.166, facing: 'south', mountedInZoneId: 'stahlMasterSuite', parentGroup: root, cutawayWall: cuts.northWoodsCut, gangs: [{ gang: 1, zoneId: 'stahlMasterSuite', label: 'Master 3-Way L' }] });
  buildCorstonToggleSwitch(ctx, { name: 'stahl.sw.masterR', switchPa: 'plate-master-bed-right', location: 'Master bedside E', x: -1.35, y: 0.78, z: Z0 + 0.166, facing: 'south', mountedInZoneId: 'stahlMasterSuite', parentGroup: root, cutawayWall: cuts.northWoodsCut, gangs: [{ gang: 1, zoneId: 'stahlMasterSuite', label: 'Master 3-Way R' }] });

  const dimmerPlateGeo = bevelledBox(0.005, 0.084, 0.084, 0.002, 3);
  const dimmerKnobGeo = prepGeo(new THREE.CylinderGeometry(0.02, 0.022, 0.022, 36));
  for (const [id, zPos] of [['dimmer-stahl-dining', 1.8], ['dimmer-stahl-living', 6.45]] as const) {
    const plate = new THREE.Mesh(dimmerPlateGeo, mats.anodizedAlum);
    plate.position.set(X3 + 0.075, 1.15, zPos);
    tagCutaway(plate, westPoolLivingCut);
    root.add(plate);

    const knob = new THREE.Mesh(dimmerKnobGeo, mats.anodizedAlum);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(X3 + 0.09, 1.15, zPos);
    knob.name = `stahl.dimmer.${id}`;
    knob.userData = { electricalDimmerId: id, zoneId: 'stahlLivingDining' };
    tagCutaway(knob, westPoolLivingCut);
    ctx.interactiveMeshes.push(knob);
    root.add(knob);
  }
}
