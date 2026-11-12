import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PoolTableBreakController, POOL_TABLE_BREAK_ID } from './pool-table-break.ts';
import { createSixPocketTableSpec, createTriangleRack } from './pool-table-physics.ts';

function createTestPoolController(): {
  controller: PoolTableBreakController;
  tableGroup: THREE.Group;
  balls: THREE.Mesh[];
  cue: THREE.Mesh;
} {
  const tableGroup = new THREE.Group();
  tableGroup.position.set(20.38, -0.675, 2.08);
  tableGroup.rotation.y = Math.PI;

  const r = 0.0254;
  const ballY = 0.7904;
  const points = [{ x: -0.48, z: 0.06 }, ...createTriangleRack({ x: 0.46, z: 0 }, r)];
  const balls = points.map((p, idx) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), new THREE.MeshBasicMaterial());
    m.name = `outbuildings.barn.poolTable.ball.${idx}`;
    m.position.set(p.x, ballY, p.z);
    tableGroup.add(m);
    return m;
  });

  const cue = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.012, 1.36, 8),
    new THREE.MeshBasicMaterial()
  );
  cue.position.set(-0.12, 0.83, -0.575);
  cue.rotation.z = -Math.PI / 2;
  tableGroup.add(cue);

  const spec = createSixPocketTableSpec(0.93, 0.47, r);
  const controller = new PoolTableBreakController({
    balls,
    cue,
    cueLength: 1.36,
    clickableTargets: [tableGroup],
    spec,
  });

  return { controller, tableGroup, balls, cue };
}

describe('PoolTableBreakController (1st-person break & re-rack)', () => {
  it('starts in racked phase with idle prompt and no active 1PV pose', () => {
    const { controller } = createTestPoolController();
    expect(controller.id).toBe(POOL_TABLE_BREAK_ID);
    expect(controller.phase).toBe('racked');
    expect(controller.describe()).toBe('Break Pool Table');
    expect(controller.isFirstPersonActive()).toBe(false);
    expect(controller.sampleFirstPersonPose()).toBeNull();
  });

  it('drives 1st-person bridge stance, draw, impact FOV boost, and rise during break', () => {
    const { controller } = createTestPoolController();
    expect(controller.trigger()).toBe(true);
    expect(controller.phase).toBe('breaking');
    expect(controller.isFirstPersonActive()).toBe(true);
    expect(controller.describe()).toBe('Finish Break Shot');

    // Step to low bridge address (t = 0.55s)
    for (let i = 0; i < 11; i++) controller.step(0.05);
    const bridgePose = controller.sampleFirstPersonPose()!;
    expect(bridgePose).not.toBeNull();
    // Low cueing bridge eye height (~0.97m above table floor = -0.675 + 0.97 = ~0.30m world Y)
    expect(bridgePose.eyePosition[1]).toBeLessThan(0.5);
    expect(bridgePose.eyePosition[1]).toBeGreaterThan(0.2);

    // Step to full cue draw-back (t = 0.95s) -> focused aim zoom (negative fovBoostDeg)
    for (let i = 0; i < 8; i++) controller.step(0.05);
    const drawPose = controller.sampleFirstPersonPose()!;
    expect(drawPose.fovBoostDeg).toBeLessThan(-1.5);

    // Step through impact (t = 1.15s) -> positive impact FOV punch
    for (let i = 0; i < 4; i++) controller.step(0.05);
    const impactPose = controller.sampleFirstPersonPose()!;
    expect(impactPose.fovBoostDeg).toBeGreaterThan(1.0);

    // Step until break finishes -> rises to standing eye height and exits 1PV
    for (let i = 0; i < 140 && controller.phase === 'breaking'; i++) {
      controller.step(0.05);
    }
    expect(controller.phase).toBe('broken');
    expect(controller.isFirstPersonActive()).toBe(false);
    expect(controller.describe()).toBe('Re-Rack Pool Balls');
  });

  it('drives 1st-person re-rack camera animation and restores all 16 balls to rack', () => {
    const { controller, balls } = createTestPoolController();
    controller.trigger();
    controller.cancelFirstPerson(); // fast-forward break to broken state
    expect(controller.phase).toBe('broken');

    // Trigger re-rack
    expect(controller.trigger()).toBe(true);
    expect(controller.phase).toBe('racking');
    expect(controller.isFirstPersonActive()).toBe(true);
    expect(controller.describe()).toBe('Finish Re-Racking');

    controller.step(0.05);
    for (let i = 0; i < 8; i++) controller.step(0.05);
    const rackMidPose = controller.sampleFirstPersonPose()!;
    expect(rackMidPose).not.toBeNull();
    expect(rackMidPose.fovBoostDeg).toBeGreaterThan(0.5);

    for (let i = 0; i < 20 && controller.phase === 'racking'; i++) {
      controller.step(0.05);
    }
    expect(controller.phase).toBe('racked');
    expect(controller.isFirstPersonActive()).toBe(false);
    expect(balls.every((b) => b.visible)).toBe(true);
  });

  it('detects player proximity around the 7ft pool table', () => {
    const { controller } = createTestPoolController();
    expect(controller.isPlayerInProximityZone(21.5, -0.675, 2.08)).toBe(true);
    expect(controller.isPlayerInProximityZone(0, 0, 0)).toBe(false);
  });
});
