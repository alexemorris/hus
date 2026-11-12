import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped Node CLI .mjs entrypoint outside tsconfig include
import { dispatchHusjsCli } from '../../../../bin/husjs.mjs';
// @ts-expect-error untyped Node CLI .mjs tool outside tsconfig include
import { parseAuditCliArgs } from '../../../../tools/husjs-audit.mjs';
import type { CutawayWallDescriptor, FloorDefinition } from '../../../core/types/scene.ts';
import {
  registerHingedDoor,
  registerSlidingDrawer,
  tagCollisionRole,
  tagCutaway,
} from '../../geometry/mesh-traits.ts';
import { InteractionRegistry } from '../../interaction/interaction-registry.ts';
import { registerStaircaseWalkableSampler } from '../../walkthrough/auto-elevation-composer.ts';
import {
  assertArchitecturalAudit,
  auditCutawayIntegrity,
  auditDoorSwings,
  auditWalkthroughReachability,
  runArchitecturalAudit,
} from '../architectural-audit.ts';

const SINGLE_FLOOR: readonly FloorDefinition[] = [
  { id: 'ground', label: 'Ground', elevationY: 0, ceilingHeight: 2.7 },
];

const TWO_FLOORS: readonly FloorDefinition[] = [
  { id: 'ground', label: 'Ground', elevationY: 0, ceilingHeight: 2.7 },
  { id: 'first', label: 'First', elevationY: 2.7, ceilingHeight: 2.5 },
];

function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.computeBoundingBox();
  return g;
}

function createMinimalDoorContext(scene: THREE.Scene) {
  const interactiveMeshes: THREE.Object3D[] = [];
  const interactions = new InteractionRegistry(interactiveMeshes);
  return {
    scene,
    interactiveMeshes,
    interactions,
  };
}

describe('architectural-audit suite', () => {
  it('passes cleanly with zero errors and zero warnings on a well-formed two-room house', () => {
    const scene = new THREE.Scene();
    const ctx = createMinimalDoorContext(scene);
    const root = new THREE.Group();
    root.name = 'cleanHouse.root';
    scene.add(root);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf0ede6 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xc8a87e });

    const slab = new THREE.Mesh(boxGeo(8.0, 0.2, 4.0), floorMat);
    slab.name = 'ground.slab';
    slab.position.set(0, -0.101, 0);
    root.add(slab);

    const northCut: CutawayWallDescriptor = {
      axis: 'z',
      coord: -2.0,
      minSpan: -4.2,
      maxSpan: 4.2,
      floor: 'ground',
      outwardSide: 'north',
    };
    const northWall = new THREE.Mesh(boxGeo(8.0, 2.68, 0.2), wallMat);
    northWall.name = 'northWall';
    northWall.position.set(0, 1.345, -2.1);
    tagCutaway(northWall, northCut);
    root.add(northWall);

    // Properly tagged wall sconce on north cutaway wall
    const sconce = new THREE.Mesh(boxGeo(0.12, 0.22, 0.08), wallMat);
    sconce.name = 'northWall.sconce';
    sconce.position.set(-2.0, 1.65, -1.94);
    tagCutaway(sconce, northCut);
    root.add(sconce);

    // Interior partition at x = 0 with a 1.0 m doorway opening (z in [-0.5 .. 0.5])
    const partN = new THREE.Mesh(boxGeo(0.12, 2.68, 1.45), wallMat);
    partN.position.set(0, 1.345, -1.275);
    const partS = new THREE.Mesh(boxGeo(0.12, 2.68, 1.45), wallMat);
    partS.position.set(0, 1.345, 1.275);
    root.add(partN, partS);

    // Unobstructed hinged door in the partition opening
    const doorMesh = new THREE.Mesh(boxGeo(0.042, 2.06, 0.9), wallMat);
    doorMesh.name = 'hallToLoungeDoor';
    doorMesh.position.set(0, 1.035, 0);
    root.add(doorMesh);
    registerHingedDoor(ctx.interactions, {
      parent: root,
      door: doorMesh,
      hingeOffset: [0, -1.035, -0.45],
      axis: 'y',
      openAngle: 1.4,
    });

    // Freestanding sofa well clear of the door swing and not tagged with cutaway
    const sofa = new THREE.Mesh(boxGeo(1.8, 0.78, 0.85), floorMat);
    sofa.name = 'lounge.sofa';
    sofa.position.set(2.6, 0.391, -1.1);
    root.add(sofa);

    const report = assertArchitecturalAudit(scene, {
      floors: SINGLE_FLOOR,
      interactions: ctx.interactions,
      failOnWarnings: true,
      roomZones: [
        {
          id: 'hall',
          name: 'Hall',
          floorId: 'ground',
          isInterior: true,
          bounds: { minX: -3.9, maxX: -0.1, minY: 0, maxY: 2.7, minZ: -1.9, maxZ: 1.9 },
        },
        {
          id: 'lounge',
          name: 'Lounge',
          floorId: 'ground',
          isInterior: true,
          bounds: { minX: 0.1, maxX: 3.9, minY: 0, maxY: 2.7, minZ: -1.9, maxZ: 1.9 },
        },
      ],
    });

    expect(report.passed).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.checks.zFighting.status).toBe('pass');
    expect(report.checks.cutaway.status).toBe('pass');
    expect(report.checks.doorSwings.status).toBe('pass');
    expect(report.checks.walkthrough.status).toBe('pass');
  });

  it('catches freestanding cutaway-tagged toilet, invalid cutaway descriptors, and untagged wall switches', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.name = 'cutawayBugHouse.root';
    scene.add(root);

    const mat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const southCut: CutawayWallDescriptor = {
      axis: 'z',
      coord: 3.6,
      minSpan: -4.0,
      maxSpan: 4.0,
      floor: 'ground',
      outwardSide: 'south',
    };

    const southWall = new THREE.Mesh(boxGeo(8.0, 2.7, 0.24), mat);
    southWall.name = 'southExteriorWall';
    southWall.position.set(0, 1.35, 3.72);
    tagCutaway(southWall, southCut);
    root.add(southWall);

    // Freestanding toilet 1.8 m inboard of southCut mistakenly tagged with southCut
    const freestandingToilet = new THREE.Group();
    freestandingToilet.name = 'bathroom.freestandingToilet';
    const pan = new THREE.Mesh(boxGeo(0.38, 0.42, 0.65), mat);
    pan.position.set(0, 0.21, 0);
    freestandingToilet.add(pan);
    freestandingToilet.position.set(1.2, 0, 1.8);
    tagCutaway(freestandingToilet, southCut);
    root.add(freestandingToilet);

    // Cutaway object with undeclared floor ID and inverted minSpan >= maxSpan
    const badTagged = new THREE.Mesh(boxGeo(0.5, 0.5, 0.1), mat);
    badTagged.name = 'atticGhostTrim';
    badTagged.position.set(0, 1.2, 3.6);
    tagCutaway(badTagged, {
      axis: 'z',
      coord: 3.6,
      minSpan: 2.0,
      maxSpan: -2.0,
      floor: 'nonexistent-attic',
    });
    root.add(badTagged);

    // Untagged wall switch mounted directly on southExteriorWall (< 0.18 m from z = 3.6)
    const untaggedSwitch = new THREE.Group();
    untaggedSwitch.name = 'hall.untaggedSwitchPlate';
    const plate = new THREE.Mesh(boxGeo(0.086, 0.086, 0.008), mat);
    untaggedSwitch.add(plate);
    untaggedSwitch.position.set(-1.5, 1.15, 3.56);
    root.add(untaggedSwitch);

    const findings = auditCutawayIntegrity(scene, { floors: SINGLE_FLOOR });
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('FREESTANDING_CUTAWAY_OBJECT');
    expect(codes).toContain('INVALID_CUTAWAY_FLOOR');
    expect(codes).toContain('INVALID_CUTAWAY_SPAN');
    expect(codes).toContain('MISSING_CUTAWAY_TAG');
  });

  it('catches blocked hinged door swings and blocked sliding drawers while restoring initial poses', () => {
    const scene = new THREE.Scene();
    const ctx = createMinimalDoorContext(scene);
    const root = new THREE.Group();
    root.name = 'doorAudit.root';
    scene.add(root);

    const mat = new THREE.MeshStandardMaterial({ color: 0xdddddd });

    const doorLeaf = new THREE.Mesh(boxGeo(0.85, 2.05, 0.044), mat);
    doorLeaf.name = 'bedroomDoor';
    doorLeaf.position.set(0, 1.025, 0);
    root.add(doorLeaf);
    const pivot = registerHingedDoor(ctx.interactions, {
      parent: root,
      door: doorLeaf,
      hingeOffset: [-0.425, -1.025, 0],
      axis: 'y',
      openAngle: -1.45,
    });
    const initialRotY = pivot.rotation.y;

    // Place a washstand right inside the door's 90-degree swing arc
    const blockingWashstand = new THREE.Mesh(boxGeo(0.6, 0.85, 0.5), mat);
    blockingWashstand.name = 'blockingWashstand';
    blockingWashstand.position.set(-0.1, 0.425, 0.55);
    root.add(blockingWashstand);

    // Register a sliding drawer blocked by an island stool
    const drawerGroup = new THREE.Group();
    drawerGroup.name = 'kitchenPanDrawer';
    drawerGroup.position.set(3.0, 0.35, 0);
    const drawerBox = new THREE.Mesh(boxGeo(0.6, 0.28, 0.5), mat);
    drawerGroup.add(drawerBox);
    root.add(drawerGroup);
    registerSlidingDrawer(ctx.interactions, {
      group: drawerGroup,
      slideDelta: [0, 0, 0.48],
    });
    const initialDrawerZ = drawerGroup.position.z;

    const blockingStool = new THREE.Mesh(boxGeo(0.4, 0.65, 0.4), mat);
    blockingStool.name = 'blockingStool';
    blockingStool.position.set(3.0, 0.325, 0.58);
    root.add(blockingStool);

    const findings = auditDoorSwings(scene, { interactions: ctx.interactions });
    expect(findings.map((f) => f.code)).toContain('DOOR_SWING_BLOCKED');
    expect(findings.map((f) => f.code)).toContain('DRAWER_SLIDE_BLOCKED');

    // Verify zero residual pose mutation
    expect(pivot.rotation.y).toBeCloseTo(initialRotY, 6);
    expect(drawerGroup.position.z).toBeCloseTo(initialDrawerZ, 6);

    // Tagging obstacles as ignore clears the door/drawer collision
    tagCollisionRole(blockingWashstand, 'ignore');
    tagCollisionRole(blockingStool, 'ignore');
    expect(auditDoorSwings(scene, { interactions: ctx.interactions })).toEqual([]);
  });

  it('catches low 1.60 m staircase bulkhead headroom and walled-off unreachable rooms', () => {
    const scene = new THREE.Scene();
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });

    // Staircase from Y = 0 to Y = 2.7 m running north (-Z) from z = 2.5 to z = -0.7
    const stairGroup = new THREE.Group();
    stairGroup.name = 'hallStaircase';
    const ramp = new THREE.Mesh(boxGeo(0.95, 0.14, 3.2), mat);
    ramp.name = 'staircase.tread_main';
    ramp.position.set(0, 1.35, 0.9);
    stairGroup.add(ramp);
    scene.add(stairGroup);

    registerStaircaseWalkableSampler(stairGroup, {
      bottomY: 0,
      topY: 2.7,
      voidOpeningXZ: [
        [-0.475, 2.5],
        [0.475, 2.5],
        [0.475, -0.7],
        [-0.475, -0.7],
      ],
      bounds: new THREE.Box3(
        new THREE.Vector3(-0.475, 0, -0.7),
        new THREE.Vector3(0.475, 2.7, 2.5)
      ),
      sampleWalkableY(wx: number, wz: number): number | null {
        if (Math.abs(wx) > 0.475 || wz < -0.7 || wz > 2.5) return null;
        return ((2.5 - wz) / 3.2) * 2.7;
      },
    });

    // Adversarial low bulkhead at Y = 2.30 m directly above mid-flight treads (~0.84 m -> 1.34 m headroom < 1.95 m!)
    const lowBulkhead = new THREE.Mesh(boxGeo(1.2, 0.24, 1.2), mat);
    lowBulkhead.name = 'first.lowBulkheadSlab';
    lowBulkhead.position.set(0, 2.3, 1.5);
    scene.add(lowBulkhead);

    // Solid wall sealing off 'secretRoom' with no doorway
    const sealNorth = new THREE.Mesh(boxGeo(4.0, 2.7, 0.2), mat);
    sealNorth.position.set(5.0, 1.35, -2.0);
    const sealSouth = new THREE.Mesh(boxGeo(4.0, 2.7, 0.2), mat);
    sealSouth.position.set(5.0, 1.35, 2.0);
    const sealWest = new THREE.Mesh(boxGeo(0.2, 2.7, 4.0), mat);
    sealWest.position.set(3.0, 1.35, 0);
    const sealEast = new THREE.Mesh(boxGeo(0.2, 2.7, 4.0), mat);
    sealEast.position.set(7.0, 1.35, 0);
    scene.add(sealNorth, sealSouth, sealWest, sealEast);

    const report = runArchitecturalAudit(scene, {
      floors: TWO_FLOORS,
      skipChecks: ['zFighting', 'cutaway', 'doorSwings'],
      roomZones: [
        {
          id: 'entryHall',
          name: 'Entry Hall',
          floorId: 'ground',
          isInterior: true,
          bounds: { minX: -2.5, maxX: 2.5, minY: 0, maxY: 2.7, minZ: -2.0, maxZ: 3.0 },
        },
        {
          id: 'secretRoom',
          name: 'Walled-Off Room',
          floorId: 'ground',
          isInterior: true,
          bounds: { minX: 3.3, maxX: 6.7, minY: 0, maxY: 2.7, minZ: -1.7, maxZ: 1.7 },
        },
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.checks.zFighting.status).toBe('skipped');
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain('LOW_STAIR_HEADROOM');
    expect(codes).toContain('UNREACHABLE_ROOM_ZONE');

    // Raising the bulkhead above 4.0 m clears LOW_STAIR_HEADROOM
    lowBulkhead.position.y = 4.2;
    const afterRaising = auditWalkthroughReachability(scene, {
      floors: TWO_FLOORS,
      roomZones: [
        {
          id: 'entryHall',
          name: 'Entry Hall',
          floorId: 'ground',
          isInterior: true,
          bounds: { minX: -2.5, maxX: 2.5, minY: 0, maxY: 2.7, minZ: -2.0, maxZ: 3.0 },
        },
      ],
    });
    expect(afterRaising.map((f) => f.code)).not.toContain('LOW_STAIR_HEADROOM');
  });

  it('catches coplanar z-fighting overlaps via runArchitecturalAudit and throws via assertArchitecturalAudit', () => {
    const scene = new THREE.Scene();
    const matA = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const matB = new THREE.MeshStandardMaterial({ color: 0xdddddd });

    const boxA = new THREE.Mesh(boxGeo(1.5, 1.5, 0.2), matA);
    boxA.name = 'wallA';
    const boxB = new THREE.Mesh(boxGeo(1.5, 1.5, 0.2), matB);
    boxB.name = 'wallB';
    boxB.position.set(0.2, 0, 0.0001);
    scene.add(boxA, boxB);

    const report = runArchitecturalAudit(scene, {
      skipChecks: ['cutaway', 'doorSwings', 'walkthrough'],
    });
    expect(report.passed).toBe(false);
    expect(report.checks.zFighting.status).toBe('fail');
    expect(report.findings[0]?.code).toBe('COPLANAR_Z_FIGHTING');
    expect(() =>
      assertArchitecturalAudit(scene, {
        skipChecks: ['cutaway', 'doorSwings', 'walkthrough'],
      })
    ).toThrow(/Architectural audit failed/);
  });

  it('parses husjs audit CLI flags (--house, --strict, --json, --skip)', () => {
    const parsed = parseAuditCliArgs([
      '--house',
      'stahl-house',
      '--strict',
      '--json',
      '--skip',
      'zFighting,cutaway',
    ]);
    expect(parsed).toEqual({
      help: false,
      house: 'stahl-house',
      allExamples: false,
      strict: true,
      json: true,
      skipChecks: ['zFighting', 'cutaway'],
    });
    expect(() => parseAuditCliArgs(['--skip', 'bogusCheck'])).toThrow(/Unknown check/);
  });

  it('executes husjs audit --house simple-flat --strict end-to-end via dispatchHusjsCli', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const code = await dispatchHusjsCli(
      ['audit', '--house', 'simple-flat', '--strict', '--json'],
      { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) }
    );
    expect(errors).toEqual([]);
    expect(code).toBe(0);
    const report = JSON.parse(logs.join('\n'));
    expect(report.passed).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  }, 25000);
});
