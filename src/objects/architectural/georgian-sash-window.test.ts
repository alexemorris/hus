import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AcousticPortalState } from '../../core/types/acoustics.ts';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import {
  createGeorgianSashWindow,
  registerVerticalSlidingSash,
} from './georgian-sash-window.ts';

describe('georgian-sash-window', () => {
  it('builds a classic 6-over-6 Georgian sash window (12 glazed portal panes) with gauged-brick jack-arch lintel and sawn Yorkstone sill', () => {
    const win = createGeorgianSashWindow({
      id: 'parlourWindowNorth',
      label: 'Parlour Sash Window',
      width: 1.08,
      height: 1.85,
      wallThickness: 0.26,
      lintel: 'gauged-brick-jack-arch',
      sill: 'yorkstone',
      zone: 'parlour',
    });

    // Classic six-over-six glazing: 3x2 upper + 3x2 lower = 12 glazed portal panes
    expect(win.glassPanes.length).toBe(12);
    for (const pane of win.glassPanes) {
      expect(pane.userData.isExteriorGlazedPortal).toBe(true);
    }

    // Odd voussoir count across jack-arch lintel + recessed mortar joints
    expect(win.voussoirCount % 2).toBe(1);
    expect(win.voussoirCount).toBeGreaterThanOrEqual(11);

    let voussoirMeshes = 0;
    let mortarMeshes = 0;
    let sillMesh: THREE.Mesh | null = null;
    win.group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj.name.includes('.jackArchVoussoir_')) voussoirMeshes++;
      if (obj.name.includes('.jackArchMortar_')) mortarMeshes++;
      if (obj.name.endsWith('.stoneSill')) sillMesh = obj;
    });
    expect(voussoirMeshes).toBe(win.voussoirCount);
    expect(mortarMeshes).toBe(win.voussoirCount - 1);
    expect(sillMesh).not.toBeNull();

    // Yorkstone sill extends 45mm wider on both sides (1.08 + 0.09 = 1.17m) and projects 55mm proud of exterior brick face (-0.13 - 0.055 = -0.185m)
    expect(win.sillWidthM).toBeCloseTo(1.08 + 0.09, 5);
    expect(win.sillProjectionM).toBeCloseTo(0.055, 5);
    const sillBox = new THREE.Box3().setFromObject(sillMesh!);
    expect(sillBox.max.x - sillBox.min.x).toBeCloseTo(1.17, 4);
    expect(sillBox.min.z).toBeCloseTo(-0.13 - 0.055, 4);
  });

  it('supports Regency/Victorian 3-over-6 glazing (9 panes), stone keystone arch, sash horns, and strict Z-plane separation between upper & lower sashes', () => {
    const win = createGeorgianSashWindow({
      panesCols: 3,
      panesTopRows: 1,
      panesBottomRows: 2,
      lintel: 'stone-keystone-arch',
      includeHorns: true,
    });

    expect(win.glassPanes.length).toBe(9);

    let keystoneFound = false;
    let hornCount = 0;
    win.group.traverse((obj) => {
      if (obj.name.endsWith('.jackArchKeystone')) keystoneFound = true;
      if (obj.name.includes('.horn_')) hornCount++;
    });
    expect(keystoneFound).toBe(true);
    expect(hornCount).toBe(2);

    // Verify upper outer sash and lower inner sliding sash occupy strictly disjoint Z planes (4 mm parting-bead gap)
    let upperStile: THREE.Mesh | null = null;
    let lowerStile: THREE.Mesh | null = null;
    win.upperSashGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.name.includes('.stile_left')) upperStile = obj;
    });
    win.lowerSashGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.name.includes('.stile_left')) lowerStile = obj;
    });
    expect(upperStile).not.toBeNull();
    expect(lowerStile).not.toBeNull();

    const upperBox = new THREE.Box3().setFromObject(upperStile!);
    const lowerBox = new THREE.Box3().setFromObject(lowerStile!);
    expect(lowerBox.min.z - upperBox.max.z).toBeCloseTo(0.004, 4);
    expect(lowerBox.min.z).toBeGreaterThan(upperBox.max.z);
  });

  it('animates lowerSashGroup.position.y, Fitch fastener lever, openness 0->1, acoustic portal state, and recursive cutawayWall tagging', () => {
    const interactions = new InteractionRegistry([]);
    const registeredPortalProviders: (() => AcousticPortalState)[] = [];
    (
      interactions as unknown as {
        registerExteriorAcousticPortal: (fn: () => AcousticPortalState) => void;
      }
    ).registerExteriorAcousticPortal = (fn) => {
      registeredPortalProviders.push(fn);
    };

    const cutawayWall: CutawayWallDescriptor = {
      axis: 'z',
      coord: -3.2,
      minSpan: -2.0,
      maxSpan: 2.0,
      floor: 'ground',
      outwardSide: 'north',
    };

    const win = createGeorgianSashWindow({
      id: 'hallSashWindow',
      label: 'Hall Sash Window',
      position: [1.2, 0.9, -3.2],
      cutawayWall,
      interactions,
      zone: 'hall',
    });

    expect(win.controller).toBeDefined();
    const ctrl = win.controller!;
    expect(registeredPortalProviders.length).toBe(1);

    // Both static frame meshes AND dynamic sliding lower sash meshes carry cutawayWall metadata,
    // while lowerSashGroup also carries dynamic batch exclusion.
    expect(win.group.userData.isCutawayWall).toBe(true);
    expect(win.group.userData.cutawayWall).toEqual(cutawayWall);
    expect(win.lowerSashGroup.userData.isDynamicBatchExcluded).toBe(true);
    expect(win.lowerSashGroup.userData.isCutawayWall).toBe(true);

    let untaggedMeshes = 0;
    let lowerDynamicMeshes = 0;
    win.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (!obj.userData.isCutawayWall || obj.userData.cutawayWall !== cutawayWall) {
          untaggedMeshes++;
        }
      }
    });
    win.lowerSashGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.isDynamicBatchExcluded) {
        lowerDynamicMeshes++;
      }
    });
    expect(untaggedMeshes).toBe(0);
    expect(lowerDynamicMeshes).toBeGreaterThan(0);

    // Initial closed state
    expect(ctrl.getOpenness01()).toBe(0);
    expect(ctrl.describe()).toBe('Open Hall Sash Window');
    expect(win.lowerSashGroup.position.y).toBeCloseTo(win.closedLowerSashY, 5);
    expect(win.fitchLeverPivot.rotation.y).toBeCloseTo(0, 5);
    expect(registeredPortalProviders[0]!().openness).toBe(0);

    // Click / trigger to slide open
    expect(interactions.handleInteractableClick('hallSashWindow')).toBe(true);
    expect(ctrl.describe()).toBe('Close Hall Sash Window');

    // Step halfway
    expect(ctrl.step(0.325)).toBe(true);
    expect(ctrl.getOpenness01()).toBeGreaterThan(0.3);
    expect(ctrl.getOpenness01()).toBeLessThan(0.7);
    expect(win.fitchLeverPivot.rotation.y).toBeCloseTo(Math.PI * 0.5, 3);

    // Step to full open
    ctrl.step(0.5);
    expect(ctrl.getOpenness01()).toBeCloseTo(1, 5);
    expect(win.lowerSashGroup.position.y).toBeCloseTo(
      win.closedLowerSashY + win.maxOpenTravelM,
      5
    );
    const openPortal = ctrl.getAcousticPortalState();
    expect(openPortal.openness).toBeCloseTo(1, 5);
    expect(openPortal.position).toEqual([1.2, 0.9, -3.2]);
    expect(openPortal.areaM2).toBeCloseTo(win.clearOpeningWidthM * win.maxOpenTravelM, 5);

    // Trigger again to close smoothly back to 0
    expect(ctrl.trigger()).toBe(true);
    ctrl.step(0.75);
    expect(ctrl.getOpenness01()).toBeCloseTo(0, 5);
    expect(win.lowerSashGroup.position.y).toBeCloseTo(win.closedLowerSashY, 5);
    expect(win.fitchLeverPivot.rotation.y).toBeCloseTo(0, 5);
  });

  it('supports standalone registerVerticalSlidingSash on a pre-built window', () => {
    const win = createGeorgianSashWindow({ id: 'principalWindow' });
    const registry = new InteractionRegistry([]);
    const ctrl = registerVerticalSlidingSash(registry, {
      windowGroup: win.group,
      lowerSashGroup: win.lowerSashGroup,
      fitchLeverPivot: win.fitchLeverPivot,
      id: 'principalWindow',
      maxOpenTravelM: win.maxOpenTravelM,
      clearOpeningWidthM: win.clearOpeningWidthM,
    });

    const dynSet = new Set<THREE.Object3D>();
    ctrl.collectDynamicObjects(dynSet);
    expect(dynSet.has(win.lowerSashGroup)).toBe(true);
    expect(ctrl.trigger()).toBe(true);
    ctrl.step(1.0);
    expect(ctrl.getOpenness01()).toBe(1);
  });
});
