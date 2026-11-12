import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AcousticPortalState } from '../../../core/types/acoustics.ts';
import { detectZFighting } from '../../../engine/diagnostics/z-fighting-detector.ts';
import { InteractionRegistry } from '../../../engine/interaction/interaction-registry.ts';
import {
  createCorniceRun,
  createDadoRun,
  createPanellingRun,
  createPictureRailRun,
} from '../room-trim-and-panelling.ts';
import {
  createMouldingPath,
  createScribedStepSkirting,
  createSkirtingRun,
} from '../skirting-run.ts';
import { createFloorSlab, createWallNetwork } from '../wall-and-slab-builders.ts';
import { createWallFaceFrame, placeOnWall } from '../wall-mounting.ts';
import { populateWallOpenings } from '../wall-openings.ts';

const testMat = new THREE.MeshStandardMaterial({ color: 0xeae5dc, roughness: 0.7 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x8b6a47, roughness: 0.6 });

describe('Stage 4.11a — Wall-Relative Mounting, Room-Trim/Panelling Engine & Unified Wall Openings', () => {
  describe('1. Wall-Relative Mounting (placeOnWall & BuiltWallSegment.mount)', () => {
    it('orients +Z into the room across all 4 cardinal walls and skewed 45° walls with +0.5 mm anti-z-fight standoff and cutaway inheritance', () => {
      const walls = createWallNetwork({
        floor: 'ground',
        height: 2.7,
        walls: [
          { id: 'north', from: [-2, -2], to: [2, -2], thickness: 0.26, align: 'interior' },
          { id: 'east', from: [2, -2], to: [2, 2], thickness: 0.26, align: 'interior' },
          { id: 'south', from: [2, 2], to: [-2, 2], thickness: 0.26, align: 'interior' },
          { id: 'west', from: [-2, 2], to: [-2, -2], thickness: 0.26, align: 'interior' },
        ],
      });

      const scene = new THREE.Group();
      scene.add(walls.group);

      const expectedRoomNormals: Record<string, [number, number]> = {
        north: [0, 1],
        east: [-1, 0],
        south: [0, -1],
        west: [1, 0],
      };

      for (const wallId of ['north', 'east', 'south', 'west'] as const) {
        const seg = walls.getSegment(wallId)!;
        expect(seg).toBeDefined();

        // Backplate mesh spanning Z in [0, 0.012] so local origin is on back surface
        const plateGeo = new THREE.BoxGeometry(0.16, 0.09, 0.012);
        plateGeo.translate(0, 0, 0.006);
        const plate = new THREE.Mesh(plateGeo, testMat);
        plate.name = `switch.${wallId}`;

        seg.mount(plate, {
          side: 'interior',
          fraction: 0.5,
          elevationY: 1.15,
          parent: scene,
        });

        plate.updateMatrixWorld(true);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(plate.quaternion);
        const [enx, enz] = expectedRoomNormals[wallId];
        expect(forward.x).toBeCloseTo(enx, 5);
        expect(forward.z).toBeCloseTo(enz, 5);
        expect(plate.position.y).toBeCloseTo(1.15, 5);

        // Verify automatic cutaway inheritance from exterior wall
        expect(plate.userData.isCutawayWall).toBe(true);
        expect(plate.userData.cutawayWall).toEqual(walls.getWallCutaway(wallId));
      }

      // Exterior mount resolves outward face & +0.5 mm clear of outer brick plane
      const lanternGeo = new THREE.BoxGeometry(0.2, 0.3, 0.14);
      const lantern = new THREE.Mesh(lanternGeo, testMat);
      walls.mount('south', lantern, {
        side: 'exterior',
        anchor: 'back',
        offsetFromCenterM: 0.6,
        elevationY: 1.8,
        parent: scene,
      });
      lantern.updateMatrixWorld(true);
      const southOutForward = new THREE.Vector3(0, 0, 1).applyQuaternion(lantern.quaternion);
      expect(southOutForward.z).toBeCloseTo(1, 5);
      // South wall interior is z = 2.0, thickness = 0.26 -> exterior face is z = 2.26;
      // anchor: 'back' shifts center to 2.26 + 0.0005 + 0.07 = 2.3305
      expect(lantern.position.z).toBeCloseTo(2.26 + 0.0005 + 0.07, 5);

      // Skewed 45° wall frame + objectForward axis support
      const diagFrame = createWallFaceFrame({
        originXZ: [0, 0],
        toXZ: [2, 2],
        roomSide: 'left',
        floorY: 0.1,
      });
      const sconce = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.1), testMat);
      placeOnWall(sconce, diagFrame, {
        alongM: Math.SQRT2,
        elevationY: 1.5,
        anchor: 'back',
        objectForward: '+x',
      });
      sconce.updateMatrixWorld(true);
      const sconcePlusX = new THREE.Vector3(1, 0, 0).applyQuaternion(sconce.quaternion);
      expect(sconcePlusX.x).toBeCloseTo(Math.SQRT1_2, 5);
      expect(sconcePlusX.z).toBeCloseTo(-Math.SQRT1_2, 5);
      expect(sconce.position.y).toBeCloseTo(1.6, 5);

      // Zero z-fighting between all mounted plates/lanterns and host walls
      scene.updateMatrixWorld(true);
      expect(detectZFighting(scene)).toHaveLength(0);
    });
  });

  describe('2. Generalized Room-Trim & Wainscot Panelling Engine + Scribed Step Skirting', () => {
    it('sweeps cornice, dado, picture rail, and all 3 panelling styles around L-corners & chimney-breast U-returns with gaps, cutaway splitting, and 0 z-fighting', () => {
      // Room with chimney-breast U-return on the north wall (-3..3 x -2..2, breast at x in [-0.7, 0.7] projecting to z = -1.6)
      const roomRing: [number, number][] = [
        [-3, -2],
        [-0.7, -2],
        [-0.7, -1.6],
        [0.7, -1.6],
        [0.7, -2],
        [3, -2],
        [3, 2],
        [-3, 2],
      ];

      const walls = createWallNetwork({
        floor: 'ground',
        height: 2.8,
        walls: roomRing.map((pt, idx) => ({
          id: `w_${idx}`,
          from: pt,
          to: roomRing[(idx + 1) % roomRing.length]!,
          thickness: 0.24,
          align: 'interior',
        })),
      });

      const fireplaceGap = [
        {
          boxXZ: { minX: -0.45, maxX: 0.45, minZ: -1.7, maxZ: -1.5 },
          cap: 'selfReturn' as const,
        },
      ];

      for (const style of ['tongue-and-groove', 'fielded-georgian', 'shaker-batten'] as const) {
        const scene = new THREE.Group();
        scene.add(walls.group);

        const slab = createFloorSlab({
          wallNetwork: walls,
          elevationY: 0,
          floorMaterial: floorMat,
        });
        const upperSlab = createFloorSlab({
          wallNetwork: walls,
          elevationY: 2.8 + 0.22,
          thickness: 0.22,
          floorMaterial: floorMat,
        });
        scene.add(slab.slabGroup, upperSlab.slabGroup);

        const cornice = createCorniceRun({
          points: roomRing,
          closed: true,
          roomSide: 'right',
          ceilingY: 2.8,
          profile: style === 'fielded-georgian' ? 'georgian-dentil' : 'georgian-cyma',
          cutawayWalls: walls,
          material: testMat,
        });

        const pictureRail = createPictureRailRun({
          points: roomRing,
          closed: true,
          roomSide: 'right',
          floorY: 0,
          elevationY: 2.25,
          cutawayWalls: walls,
          material: testMat,
        });

        const panelling = createPanellingRun({
          points: roomRing,
          closed: true,
          roomSide: 'right',
          floorY: 0,
          height: 1.05,
          style,
          gaps: fireplaceGap,
          cutawayWalls: walls,
          material: testMat,
        });

        scene.add(cornice, pictureRail, panelling);
        scene.updateMatrixWorld(true);

        // Verify cutaway tagging on exterior segments while keeping interior chimney-breast sides split cleanly
        let cutawayTaggedCount = 0;
        panelling.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.userData.isCutawayWall) {
            cutawayTaggedCount++;
          }
        });
        expect(cutawayTaggedCount).toBeGreaterThan(0);

        const overlaps = detectZFighting(scene);
        expect(overlaps, `Expected 0 z-fighting overlaps for panelling style '${style}'`).toHaveLength(0);
      }

      // Standalone dado run check
      const dado = createDadoRun({
        points: [
          [-2, 0],
          [2, 0],
        ],
        roomSide: 'right',
        elevationY: 0.95,
        profile: 'astragal-dado',
        gaps: [{ startDist: 1.6, endDist: 2.4, cap: 'butt' }],
        material: testMat,
      });
      expect(dado.interiorMeshes).toHaveLength(1);
      expect(dado.totalLengthM).toBeCloseTo(3.2, 5);
    });

    it('builds scribed step skirting (scribedStepsTo & createScribedStepSkirting) turning a 90° corner into a pilaster with 0 z-fighting', () => {
      const scene = new THREE.Group();

      // Backing wall + 90° return pilaster + 2 solid steps
      const wall = createWallNetwork({
        floor: 'ground',
        height: 2.4,
        walls: [
          { id: 'stairWall', from: [0, 0], to: [1.6, 0], thickness: 0.2, align: 'interior', outwardSide: 'north' },
          { id: 'pilasterReturn', from: [1.6, 0], to: [1.6, 0.45], thickness: 0.2, align: 'interior', outwardSide: 'east' },
        ],
      });
      scene.add(wall.group);

      // Step 1: x in [0.4, 0.9], y in [0, 0.18]; Step 2: x in [0.9, 1.6], y in [0, 0.36]
      const step1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.179, 0.9), floorMat);
      step1.position.set(0.65, 0.0895, 0.451);
      const step2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.359, 0.9), floorMat);
      step2.position.set(1.25, 0.1795, 0.451);
      scene.add(step1, step2);

      const path = createMouldingPath(0.05, 0, 0, { roomSide: 'right' })
        .lineTo(0.4, 0, 0)
        .scribedStepsTo(1.2, 0.36, 0, {
          steps: [
            { atDist: 0.0, y: 0.18 },
            { atDist: 0.5, y: 0.36 },
          ],
        })
        .lineTo(1.6, 0.36, 0)
        .lineTo(1.6, 0.36, 0.4);

      const scribedSkirting = createScribedStepSkirting({
        path,
        height: 0.165,
        thickness: 0.02,
        cutawayWalls: wall,
        material: testMat,
      });
      scene.add(scribedSkirting);

      scene.updateMatrixWorld(true);
      expect(scribedSkirting.children.length).toBeGreaterThan(0);
      expect(detectZFighting(scene)).toHaveLength(0);
    });
  });

  describe('3. Unified Wall Openings + Slab + Skirting + Cornice + Panelling Full-Room Integration', () => {
    it('populates hinged-door, double-door, georgian-sash, casement-window, and corner-ripped doorway with automatic skirtingGaps/dadoGaps, interactions, acoustic portals, and 0 z-fighting', () => {
      const interactions = new InteractionRegistry([]);
      const registeredPortals: (() => AcousticPortalState)[] = [];
      const origRegister = interactions.registerExteriorAcousticPortal.bind(interactions);
      interactions.registerExteriorAcousticPortal = (fn) => {
        registeredPortals.push(fn);
        origRegister(fn);
      };

      const roomPoly: [number, number][] = [
        [-3.0, -2.2],
        [3.0, -2.2],
        [3.0, 2.2],
        [-3.0, 2.2],
      ];

      const walls = createWallNetwork({
        floor: 'ground',
        height: 2.85,
        ctx: interactions,
        walls: [
          { id: 'north', from: [-3.0, -2.2], to: [3.0, -2.2], thickness: 0.26, align: 'interior' },
          { id: 'east', from: [3.0, -2.2], to: [3.0, 2.2], thickness: 0.26, align: 'interior' },
          { id: 'south', from: [3.0, 2.2], to: [-3.0, 2.2], thickness: 0.26, align: 'interior' },
          { id: 'west', from: [-3.0, 2.2], to: [-3.0, -2.2], thickness: 0.26, align: 'interior' },
          { id: 'partition', from: [0.2, -2.2], to: [0.2, 0.2], thickness: 0.14, kind: 'partition' },
        ],
        openings: [
          // Sash window on north wall (left bay)
          {
            id: 'northSash',
            wallId: 'north',
            offsetM: 1.4,
            width: 1.08,
            height: 1.65,
            sillY: 0.82,
            kind: 'georgian-sash',
            label: 'North Parlour Sash',
          },
          // Exterior double French doors on south wall
          {
            id: 'gardenFrenchDoors',
            wallId: 'south',
            offsetM: 3.0,
            width: 1.5,
            height: 2.15,
            sillY: 0,
            kind: 'double-door',
            leafStyle: 'glazed',
            threshold: 'yorkstone',
          },
          // Corner-adjacent hinged door (< architraveWidth from west wall corner -> rips architrave leg!)
          {
            id: 'cornerDoor',
            wallId: 'south',
            offsetM: 5.52, // center at 5.52 of 6.0 m wall, width 0.88 -> jamb at 5.96 (only 40 mm from corner < 75 mm architrave!)
            width: 0.88,
            height: 2.08,
            sillY: 0,
            kind: 'hinged-door',
            leafStyle: 'six-panel',
            threshold: 'oak',
          },
          // Cased portal on interior partition
          {
            id: 'hallPortal',
            wallId: 'partition',
            offsetM: 1.2,
            width: 0.92,
            height: 2.1,
            sillY: 0,
            kind: 'cased-portal',
          },
        ],
      });

      // Also exercise standalone populateWallOpenings on east wall
      const extraBuilt = populateWallOpenings(interactions, walls, [
        {
          id: 'eastCasement',
          wallId: 'east',
          offsetM: 2.2,
          width: 0.95,
          height: 1.25,
          sillY: 0.92,
          kind: 'casement-window',
        },
      ]);
      expect(extraBuilt).toHaveLength(1);
      expect(walls.openings).toHaveLength(5);

      // Automatic skirtingGaps & dadoGaps populated
      expect(walls.skirtingGaps.length).toBeGreaterThanOrEqual(3);
      expect(walls.dadoGaps.length).toBeGreaterThanOrEqual(5);

      // Verify cornerDoor ripped its corner-side architrave so it does not protrude past the west interior wall plane (x = -3.0)
      const cornerOpening = walls.openings.find((o) => o.id === 'cornerDoor')!;
      const intArchMesh = cornerOpening.group.getObjectByName('cornerDoor.architrave_int')!;
      expect(intArchMesh).toBeDefined();
      const intArchBox = new THREE.Box3().setFromObject(intArchMesh);
      expect(intArchBox.min.x).toBeGreaterThanOrEqual(-3.0 - 1e-3);

      // Verify cutaway inheritance on exterior doors & sash window, and NO cutaway on interior partition portal
      const frenchOpening = walls.openings.find((o) => o.id === 'gardenFrenchDoors')!;
      expect(frenchOpening.doorPivots).toHaveLength(2);
      expect(frenchOpening.doorPivots[0]!.userData.isCutawayWall).toBe(true);
      expect(frenchOpening.getAcousticPortalState()?.openness).toBe(0);

      const portalOpening = walls.openings.find((o) => o.id === 'hallPortal')!;
      expect(portalOpening.group.userData.isCutawayWall).toBeUndefined();

      // Verify sash window registered acoustic portal
      expect(registeredPortals.length).toBeGreaterThanOrEqual(1);

      // Assemble complete room with floor slab, ceiling soffit, skirting, cornice, and wainscot panelling
      const scene = new THREE.Group();
      scene.add(walls.group);

      const groundSlab = createFloorSlab({
        wallNetwork: walls,
        elevationY: 0,
        floorMaterial: floorMat,
      });
      const firstFloorSlab = createFloorSlab({
        wallNetwork: walls,
        elevationY: 2.85 + 0.22,
        thickness: 0.22,
        floorMaterial: floorMat,
      });
      scene.add(groundSlab.slabGroup, firstFloorSlab.slabGroup);

      // Skirting run on north & east walls using walls.skirtingGaps + cutawayWalls: walls
      const skirting = createSkirtingRun({
        points: [
          [-3.0, -2.2],
          [3.0, -2.2],
          [3.0, 2.2],
        ],
        roomSide: 'right',
        floorY: 0,
        gaps: walls.skirtingGaps,
        cutawayWalls: walls,
        material: testMat,
      });

      // Wainscot panelling on south & west walls using walls.dadoGaps + cutawayWalls: walls
      const panelling = createPanellingRun({
        points: [
          [3.0, 2.2],
          [-3.0, 2.2],
          [-3.0, -2.2],
        ],
        roomSide: 'right',
        floorY: 0,
        height: 1.02,
        style: 'fielded-georgian',
        gaps: walls.dadoGaps,
        cutawayWalls: walls,
        material: testMat,
      });

      const cornice = createCorniceRun({
        points: roomPoly,
        closed: true,
        roomSide: 'right',
        ceilingY: 2.85,
        profile: 'georgian-cyma',
        cutawayWalls: walls,
        material: testMat,
      });

      scene.add(skirting, panelling, cornice);
      scene.updateMatrixWorld(true);

      const overlaps = detectZFighting(scene);
      expect(overlaps).toHaveLength(0);
    });
  });
});
