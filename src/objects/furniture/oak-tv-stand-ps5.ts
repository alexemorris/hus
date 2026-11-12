import * as THREE from 'three';
import { attachAssetMetadata } from '../shared/catalog-smart-metadata.ts';
import { getOrCreateCachedPropTexture } from '../../engine/textures/texture-registry.ts';
import {
  sharedBoxGeometry,
  sharedCylinderGeometry,
  sharedSphereGeometry,
} from '../shared/geometry-cache.ts';
import { tagHighLod } from '../shared/scene-helpers.ts';

export interface OakTvStandWithPs5Options {
  readonly name: string;
  readonly zone: string;
  /** World or parent-group position of the stand center on the finished floor (`y = FFL`). */
  readonly position: readonly [number, number, number];
  /** Rotation around Y in radians (`0` = front faces `-Z`, rear sits at `+Z`). */
  readonly rotationY?: number;
}

function createNaturalOakStandTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('oak-tv-stand:natural-oak-grain', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#c5a57d';
      ctx.fillRect(0, 0, 256, 256);

      for (let i = 0; i < 160; i++) {
        const y = (i * 1.6) % 256;
        const light = i % 3 === 0;
        ctx.strokeStyle = light ? 'rgba(238, 224, 200, 0.24)' : 'rgba(130, 96, 62, 0.20)';
        ctx.lineWidth = light ? 1.0 : 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        const wave = Math.sin(i * 0.41) * 3.0;
        ctx.bezierCurveTo(84, y + wave, 172, y - wave, 256, y);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/**
 * Builds a contemporary natural-oak media/TV stand (`1.05 m W × 0.38 m D × 0.52 m H`)
 * with 4 tapered oak legs, an open upper media shelf, twin lower slatted oak drawers,
 * a 46" thin-bezel 4K OLED TV on top, and a horizontal Sony PlayStation 5 (Slim Disc Edition)
 * with two DualSense wireless controllers on the open media shelf.
 *
 * Local coordinate convention (`rotationY = 0`):
 * - Stand width along `X` (`-0.525 .. +0.525 m`), height along `+Y` (`0 .. +0.52 m` stand, `+1.08 m` TV top),
 *   depth along `Z` (`-0.19 .. +0.19 m`), with front facing `-Z` and rear against `+Z`.
 */
export function buildOakTvStandWithPs5(
  parent: THREE.Object3D,
  options: OakTvStandWithPs5Options
): THREE.Group {
  const { name, zone, position, rotationY = 0 } = options;

  const root = new THREE.Group();
  root.name = name;
  root.userData.zone = zone;
  root.userData.zoneId = zone;
  root.position.set(position[0], position[1], position[2]);
  root.rotation.y = rotationY;

  const oakTex = createNaturalOakStandTexture();
  const oakMat = new THREE.MeshStandardMaterial({
    color: 0xd9c2a3,
    map: oakTex,
    roughness: 0.44,
    metalness: 0.02,
  });
  const oakRecessMat = new THREE.MeshStandardMaterial({
    color: 0x9b7e5c,
    roughness: 0.58,
    metalness: 0.02,
  });
  const darkGunmetalMat = new THREE.MeshStandardMaterial({
    color: 0x22252a,
    roughness: 0.34,
    metalness: 0.68,
  });
  const oledScreenMat = new THREE.MeshStandardMaterial({
    color: 0x090b0f,
    roughness: 0.08,
    metalness: 0.14,
  });
  const ps5MatteWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xf3f4f6,
    roughness: 0.36,
    metalness: 0.02,
  });
  const ps5PianoBlackMat = new THREE.MeshStandardMaterial({
    color: 0x101216,
    roughness: 0.08,
    metalness: 0.16,
  });
  const ps5StandbyLedMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  const controllerBlueLedMat = new THREE.MeshStandardMaterial({
    color: 0x60a5fa,
    emissive: 0x2563eb,
    emissiveIntensity: 0.55,
    roughness: 0.2,
  });
  const acrylicStandMat = new THREE.MeshStandardMaterial({
    color: 0xdbe3ec,
    roughness: 0.18,
    metalness: 0.1,
  });

  const standW = 1.05;
  const standD = 0.38;
  const standH = 0.52;
  const legH = 0.16;
  const panelT = 0.02;
  const carcassBotY = legH;
  const carcassH = standH - carcassBotY; // 0.36m

  // Four tapered splayed natural-oak cylindrical legs (Y = 0 .. 0.16m)
  const legOffX = standW * 0.5 - 0.075;
  const legOffZ = standD * 0.5 - 0.055;
  for (const [tag, sx, sz] of [
    ['fl', -1, -1],
    ['fr', 1, -1],
    ['rl', -1, 1],
    ['rr', 1, 1],
  ] as const) {
    const leg = new THREE.Mesh(
      sharedCylinderGeometry(0.02, 0.013, legH, 14),
      oakMat
    );
    leg.name = `${name}.leg_${tag}`;
    leg.position.set(sx * legOffX, legH * 0.5 + 0.0016, sz * legOffZ);
    leg.rotation.z = sx * 0.07;
    leg.rotation.x = -sz * 0.05;
    leg.castShadow = true;
    leg.receiveShadow = true;
    root.add(leg);
  }

  // Solid natural-oak cabinet carcass (1.05m W × 0.38m D, Y = 0.16 .. 0.52m)
  const topSlab = new THREE.Mesh(sharedBoxGeometry(standW, panelT, standD), oakMat);
  topSlab.name = `${name}.topSlab`;
  topSlab.position.set(0, standH - panelT * 0.5, 0);
  topSlab.castShadow = true;
  topSlab.receiveShadow = true;
  root.add(topSlab);

  const botSlab = new THREE.Mesh(sharedBoxGeometry(standW, panelT, standD), oakMat);
  botSlab.name = `${name}.bottomSlab`;
  botSlab.position.set(0, carcassBotY + panelT * 0.5, 0);
  botSlab.castShadow = true;
  botSlab.receiveShadow = true;
  root.add(botSlab);

  const sideH = carcassH - panelT * 2;
  const sideCenterY = carcassBotY + panelT + sideH * 0.5;
  for (const [sideTag, sx] of [
    ['leftCheek', -standW * 0.5 + panelT * 0.5],
    ['rightCheek', standW * 0.5 - panelT * 0.5],
  ] as const) {
    const cheek = new THREE.Mesh(sharedBoxGeometry(panelT, sideH, standD), oakMat);
    cheek.name = `${name}.${sideTag}`;
    cheek.position.set(sx, sideCenterY, 0);
    cheek.castShadow = true;
    cheek.receiveShadow = true;
    root.add(cheek);
  }

  const backT = 0.012;
  const innerW = standW - panelT * 2;
  const backPanel = new THREE.Mesh(
    sharedBoxGeometry(innerW, sideH, backT),
    oakMat
  );
  backPanel.name = `${name}.backPanel`;
  backPanel.position.set(0, sideCenterY, standD * 0.5 - backT * 0.5);
  backPanel.receiveShadow = true;
  root.add(backPanel);

  // Rear cable pass-through grommet ring in the open media shelf back
  const grommet = tagHighLod(
    new THREE.Mesh(sharedCylinderGeometry(0.024, 0.024, 0.016, 16), darkGunmetalMat)
  );
  grommet.name = `${name}.cableGrommet`;
  grommet.rotation.x = Math.PI * 0.5;
  grommet.position.set(0.08, 0.415, standD * 0.5 - backT * 0.5);
  root.add(grommet);

  // Open middle media shelf (Y_top = 0.348m) separating upper open console bay from twin lower slatted drawers
  const mediaShelfTopY = 0.348;
  const mediaShelfT = 0.018;
  const mediaShelfD = standD - backT - 0.004;
  const mediaShelf = new THREE.Mesh(
    sharedBoxGeometry(innerW, mediaShelfT, mediaShelfD),
    oakMat
  );
  mediaShelf.name = `${name}.mediaShelf`;
  mediaShelf.position.set(
    0,
    mediaShelfTopY - mediaShelfT * 0.5,
    -standD * 0.5 + 0.004 + mediaShelfD * 0.5
  );
  mediaShelf.castShadow = true;
  mediaShelf.receiveShadow = true;
  root.add(mediaShelf);

  // Lower vertical divider & twin slatted natural-oak drawers (Y = 0.180 .. 0.330m)
  const lowerClearH = mediaShelfTopY - mediaShelfT - (carcassBotY + panelT);
  const lowerCenterY = carcassBotY + panelT + lowerClearH * 0.5;
  const lowerDiv = new THREE.Mesh(
    sharedBoxGeometry(0.018, lowerClearH, mediaShelfD),
    oakMat
  );
  lowerDiv.name = `${name}.lowerCenterDivider`;
  lowerDiv.position.set(0, lowerCenterY, -standD * 0.5 + 0.004 + mediaShelfD * 0.5);
  root.add(lowerDiv);

  const drawerW = (innerW - 0.018) * 0.5 - 0.004;
  const drawerH = lowerClearH - 0.006;
  const slatCount = 5;
  const slatPitch = drawerH / slatCount;
  for (const [dIdx, dx] of [
    [1, -(0.009 + 0.002 + drawerW * 0.5)],
    [2, 0.009 + 0.002 + drawerW * 0.5],
  ] as const) {
    const drawerBacking = new THREE.Mesh(
      sharedBoxGeometry(drawerW, drawerH, 0.012),
      oakRecessMat
    );
    drawerBacking.name = `${name}.lowerDrawer_${dIdx}.backing`;
    drawerBacking.position.set(dx, lowerCenterY, -standD * 0.5 + 0.012);
    drawerBacking.castShadow = true;
    drawerBacking.receiveShadow = true;
    root.add(drawerBacking);

    for (let s = 0; s < slatCount; s++) {
      const sy = lowerCenterY - drawerH * 0.5 + slatPitch * (s + 0.5);
      const slat = new THREE.Mesh(
        sharedBoxGeometry(drawerW, slatPitch - 0.004, 0.008),
        oakMat
      );
      slat.name = `${name}.lowerDrawer_${dIdx}.slat_${s + 1}`;
      slat.position.set(dx, sy, -standD * 0.5 + 0.004);
      slat.castShadow = true;
      slat.receiveShadow = true;
      root.add(slat);
    }

    // Subtle dark-gunmetal finger-pull tab at top center of each slatted drawer
    const pullTab = tagHighLod(
      new THREE.Mesh(sharedBoxGeometry(0.064, 0.005, 0.016), darkGunmetalMat)
    );
    pullTab.name = `${name}.lowerDrawer_${dIdx}.pull`;
    pullTab.position.set(dx, lowerCenterY + drawerH * 0.5 - 0.003, -standD * 0.5 - 0.004);
    root.add(pullTab);
  }

  // 46" Thin-Bezel 4K OLED TV on Minimalist Dark-Gunmetal Pedestal Stand (on top of stand at Y = 0.52m)
  const tvGroup = new THREE.Group();
  tvGroup.name = `${name}.tv`;
  tvGroup.position.set(0, standH, 0.02);

  const pedBase = new THREE.Mesh(sharedBoxGeometry(0.38, 0.008, 0.21), darkGunmetalMat);
  pedBase.name = `${name}.tv.pedestalBase`;
  pedBase.position.set(0, 0.004, 0);
  pedBase.castShadow = true;
  pedBase.receiveShadow = true;
  tvGroup.add(pedBase);

  const pedNeck = new THREE.Mesh(sharedBoxGeometry(0.095, 0.072, 0.028), darkGunmetalMat);
  pedNeck.name = `${name}.tv.pedestalNeck`;
  pedNeck.position.set(0, 0.038, 0.022);
  pedNeck.rotation.x = -0.08;
  pedNeck.castShadow = true;
  tvGroup.add(pedNeck);

  const panelW = 0.96;
  const panelH = 0.545;
  const panelCenterY = 0.055 + panelH * 0.5; // Total TV height ~ 0.60m above stand top (0.56..0.60m)
  const bezelT = 0.005;

  const tvChassis = new THREE.Mesh(
    sharedBoxGeometry(panelW, panelH, 0.012),
    darkGunmetalMat
  );
  tvChassis.name = `${name}.tv.chassis`;
  tvChassis.position.set(0, panelCenterY, 0.004);
  tvChassis.castShadow = true;
  tvChassis.receiveShadow = true;
  tvGroup.add(tvChassis);

  const tvRearElectronicsBox = new THREE.Mesh(
    sharedBoxGeometry(panelW * 0.56, panelH * 0.46, 0.022),
    darkGunmetalMat
  );
  tvRearElectronicsBox.name = `${name}.tv.rearHousing`;
  tvRearElectronicsBox.position.set(0, panelCenterY - 0.08, 0.021);
  tvRearElectronicsBox.castShadow = true;
  tvGroup.add(tvRearElectronicsBox);

  const tvScreen = new THREE.Mesh(
    sharedBoxGeometry(panelW - bezelT * 2, panelH - bezelT * 2, 0.002),
    oledScreenMat
  );
  tvScreen.name = `${name}.tv.screen`;
  tvScreen.position.set(0, panelCenterY, -0.0025);
  tvGroup.add(tvScreen);

  root.add(tvGroup);

  // Sony PlayStation 5 (PS5 Slim Disc Edition) resting horizontally on the open oak media shelf
  const ps5Group = new THREE.Group();
  ps5Group.name = `${name}.ps5`;
  ps5Group.position.set(-0.155, mediaShelfTopY, -0.01);

  const ps5W = 0.358;
  const ps5D = 0.216;
  const ps5CoreH = 0.072;

  // Clear horizontal stand acrylic support clips
  for (const [clipTag, cx] of [
    ['left', -0.095],
    ['right', 0.095],
  ] as const) {
    const clip = tagHighLod(
      new THREE.Mesh(sharedBoxGeometry(0.018, 0.008, 0.056), acrylicStandMat)
    );
    clip.name = `${name}.ps5.standFoot_${clipTag}`;
    clip.position.set(cx, 0.004, -0.045);
    ps5Group.add(clip);
  }

  // Glossy piano-black central core chassis (recessed slightly between outer white faceplates)
  const ps5Core = new THREE.Mesh(
    sharedBoxGeometry(ps5W - 0.022, ps5CoreH, ps5D - 0.016),
    ps5PianoBlackMat
  );
  ps5Core.name = `${name}.ps5.blackCore`;
  ps5Core.position.set(0, 0.008 + ps5CoreH * 0.5, 0);
  ps5Core.castShadow = true;
  ps5Core.receiveShadow = true;
  ps5Group.add(ps5Core);

  // Curved / winged matte-white top & bottom faceplates with Slim center split groove & lower-right Disc Drive bulge
  const splitGapX = 0.003;
  const leftSplitW = ps5W * 0.44;
  const rightSplitW = ps5W - leftSplitW - splitGapX;
  const leftCenterX = -ps5W * 0.5 + leftSplitW * 0.5;
  const rightCenterX = ps5W * 0.5 - rightSplitW * 0.5;

  // Top matte-white faceplates (slightly flared overhanging wings)
  for (const [segTag, segW, segX, tiltZ] of [
    ['topLeftPlate', leftSplitW, leftCenterX, 0.018],
    ['topRightPlate', rightSplitW, rightCenterX, -0.018],
  ] as const) {
    const plate = new THREE.Mesh(
      sharedBoxGeometry(segW, 0.007, ps5D),
      ps5MatteWhiteMat
    );
    plate.name = `${name}.ps5.${segTag}`;
    plate.position.set(segX, 0.008 + ps5CoreH + 0.0035, 0);
    plate.rotation.z = tiltZ;
    plate.castShadow = true;
    plate.receiveShadow = true;
    ps5Group.add(plate);
  }

  // Bottom matte-white faceplates + optical Blu-ray disc drive housing on front-right lower quarter
  const botLeftPlate = new THREE.Mesh(
    sharedBoxGeometry(leftSplitW, 0.007, ps5D),
    ps5MatteWhiteMat
  );
  botLeftPlate.name = `${name}.ps5.bottomLeftPlate`;
  botLeftPlate.position.set(leftCenterX, 0.008, 0);
  botLeftPlate.rotation.z = -0.015;
  botLeftPlate.castShadow = true;
  ps5Group.add(botLeftPlate);

  const discDriveShell = new THREE.Mesh(
    sharedBoxGeometry(rightSplitW, 0.024, ps5D),
    ps5MatteWhiteMat
  );
  discDriveShell.name = `${name}.ps5.discDriveShell`;
  discDriveShell.position.set(rightCenterX, 0.014, 0);
  discDriveShell.castShadow = true;
  discDriveShell.receiveShadow = true;
  ps5Group.add(discDriveShell);

  const discSlot = tagHighLod(
    new THREE.Mesh(sharedBoxGeometry(0.128, 0.0025, 0.004), ps5PianoBlackMat)
  );
  discSlot.name = `${name}.ps5.discSlot`;
  discSlot.position.set(rightCenterX + 0.01, 0.017, -ps5D * 0.5 - 0.001);
  ps5Group.add(discSlot);

  // Subtle warm-amber standby LED accent strips flanking the glossy black core vents
  for (const [ledTag, ly] of [
    ['upperStandbyLed', 0.008 + ps5CoreH - 0.004],
    ['lowerStandbyLed', 0.014],
  ] as const) {
    const ledStrip = tagHighLod(
      new THREE.Mesh(sharedBoxGeometry(ps5W - 0.05, 0.0022, 0.003), ps5StandbyLedMat)
    );
    ledStrip.name = `${name}.ps5.${ledTag}`;
    ledStrip.position.set(0, ly, -ps5D * 0.5 + 0.007);
    ps5Group.add(ledStrip);
  }

  // Front USB-C ports & power button on the glossy black core
  for (const [portTag, px] of [
    ['usbC_1', -0.045],
    ['usbC_2', -0.022],
    ['powerBtn', -0.115],
  ] as const) {
    const port = tagHighLod(
      new THREE.Mesh(sharedBoxGeometry(0.009, 0.003, 0.003), darkGunmetalMat)
    );
    port.name = `${name}.ps5.${portTag}`;
    port.position.set(px, 0.008 + ps5CoreH * 0.5, -ps5D * 0.5 + 0.007);
    ps5Group.add(port);
  }

  root.add(ps5Group);

  // Two DualSense Wireless Controllers resting neatly beside the PS5 on the open media shelf
  for (const [cIdx, cx, cz, rotY] of [
    [1, 0.175, -0.035, -0.14],
    [2, 0.345, -0.02, -0.26],
  ] as const) {
    const ctrlGroup = new THREE.Group();
    ctrlGroup.name = `${name}.dualsense_${cIdx}`;
    ctrlGroup.position.set(cx, mediaShelfTopY, cz);
    ctrlGroup.rotation.y = rotY;

    // Central white bridge body
    const bridge = new THREE.Mesh(
      sharedBoxGeometry(0.104, 0.026, 0.062),
      ps5MatteWhiteMat
    );
    bridge.name = `${name}.dualsense_${cIdx}.body`;
    bridge.position.set(0, 0.019, -0.006);
    bridge.castShadow = true;
    ctrlGroup.add(bridge);

    // Sculpted left & right two-tone white grips + black inner grip trim
    for (const [gTag, sx] of [
      ['left', -1],
      ['right', 1],
    ] as const) {
      const grip = new THREE.Mesh(
        sharedCylinderGeometry(0.017, 0.013, 0.096, 12),
        ps5MatteWhiteMat
      );
      grip.name = `${name}.dualsense_${cIdx}.grip_${gTag}`;
      grip.rotation.x = Math.PI * 0.44;
      grip.rotation.z = -sx * 0.22;
      grip.position.set(sx * 0.056, 0.017, 0.016);
      grip.castShadow = true;
      ctrlGroup.add(grip);

      const blackTrim = tagHighLod(
        new THREE.Mesh(sharedCylinderGeometry(0.012, 0.01, 0.064, 10), ps5PianoBlackMat)
      );
      blackTrim.name = `${name}.dualsense_${cIdx}.blackTrim_${gTag}`;
      blackTrim.rotation.x = Math.PI * 0.44;
      blackTrim.rotation.z = -sx * 0.18;
      blackTrim.position.set(sx * 0.04, 0.015, 0.022);
      ctrlGroup.add(blackTrim);

      // Symmetrical DualSense thumbsticks
      const stickStem = tagHighLod(
        new THREE.Mesh(sharedCylinderGeometry(0.004, 0.004, 0.012, 10), ps5PianoBlackMat)
      );
      stickStem.name = `${name}.dualsense_${cIdx}.stickStem_${gTag}`;
      stickStem.position.set(sx * 0.024, 0.035, 0.012);
      ctrlGroup.add(stickStem);

      const stickCap = tagHighLod(
        new THREE.Mesh(sharedCylinderGeometry(0.009, 0.009, 0.003, 12), ps5PianoBlackMat)
      );
      stickCap.name = `${name}.dualsense_${cIdx}.stickCap_${gTag}`;
      stickCap.position.set(sx * 0.024, 0.041, 0.012);
      ctrlGroup.add(stickCap);
    }

    // Center touchpad + subtle blue lightbar edge
    const touchpad = tagHighLod(
      new THREE.Mesh(sharedBoxGeometry(0.046, 0.003, 0.028), ps5MatteWhiteMat)
    );
    touchpad.name = `${name}.dualsense_${cIdx}.touchpad`;
    touchpad.position.set(0, 0.033, -0.014);
    touchpad.rotation.x = 0.08;
    ctrlGroup.add(touchpad);

    const lightBar = tagHighLod(
      new THREE.Mesh(sharedBoxGeometry(0.05, 0.002, 0.031), controllerBlueLedMat)
    );
    lightBar.name = `${name}.dualsense_${cIdx}.lightBar`;
    lightBar.position.set(0, 0.032, -0.014);
    lightBar.rotation.x = 0.08;
    ctrlGroup.add(lightBar);

    // D-pad & action buttons
    const dpad = tagHighLod(
      new THREE.Mesh(sharedBoxGeometry(0.018, 0.003, 0.018), ps5MatteWhiteMat)
    );
    dpad.name = `${name}.dualsense_${cIdx}.dpad`;
    dpad.position.set(-0.044, 0.033, -0.01);
    ctrlGroup.add(dpad);

    for (const [bTag, bx, bz] of [
      ['triangle', 0.044, -0.019],
      ['circle', 0.053, -0.01],
      ['cross', 0.044, -0.001],
      ['square', 0.035, -0.01],
    ] as const) {
      const btn = tagHighLod(
        new THREE.Mesh(sharedSphereGeometry(0.0035, 8, 8), ps5MatteWhiteMat)
      );
      btn.name = `${name}.dualsense_${cIdx}.btn_${bTag}`;
      btn.position.set(bx, 0.033, bz);
      ctrlGroup.add(btn);
    }

    root.add(ctrlGroup);
  }

  attachAssetMetadata(root, {
    name: 'Natural Oak Media Console, 55" 4K OLED TV & Sony PlayStation 5',
    brand: 'Cox & Cox / LG / Sony',
    collection: 'Media & Living',
    sku: 'CC-OAK-TV-PS5',
    finish: 'Natural European Oak & Matte Black',
    category: 'furniture',
    dimensionsMm: [1400, 420, 1280],
    productUrl: 'https://www.coxandcox.co.uk/furniture/living-room-furniture/media-units/',
    schematicUrl: 'https://www.coxandcox.co.uk/media/spec/Oak-Media-Unit-Spec.pdf',
  });
  parent.add(root);
  return root;
}
