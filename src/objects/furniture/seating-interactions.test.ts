import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  collectSeatClickableMeshes,
  SeatInteractable,
} from './seating-interactions.ts';

describe('SeatInteractable & collectSeatClickableMeshes', () => {
  it('toggles 1st-person seated state with allowFreeLook, poseId, and activePrompt', () => {
    const anchor = new THREE.Group();
    anchor.position.set(-18.5, -0.6, 5.65);
    const cushion = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.2, 1.6),
      new THREE.MeshStandardMaterial()
    );
    cushion.name = 'sofa.seatCushion';
    const piping = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 1.6),
      new THREE.MeshStandardMaterial()
    );
    piping.name = 'sofa.seatPiping';
    anchor.add(cushion, piping);

    const clickable = collectSeatClickableMeshes(anchor);
    expect(clickable).toEqual([cushion]);

    const seat = new SeatInteractable({
      id: 'seat:test.sofa',
      label: 'Test Linen Sofa',
      aliases: ['sit on test sofa'],
      anchor,
      clickableTargets: clickable,
      localSeatPos: [-0.06, 0.44, 0],
      localFootOffset: [-0.82, 0, 0],
      localForward: [-1, 0, 0],
      seatedEyeHeightM: 0.72,
      material: 'linen',
    });

    expect(seat.isFirstPersonActive()).toBe(false);
    expect(seat.describe()).toBe('Sit on Test Linen Sofa');
    expect(seat.sampleFirstPersonPose()).toBeNull();

    // Sit down
    expect(seat.trigger()).toBe(true);
    expect(seat.isFirstPersonActive()).toBe(true);
    expect(seat.describe()).toBe('Stand Up from Test Linen Sofa');

    const pose = seat.sampleFirstPersonPose();
    expect(pose).not.toBeNull();
    expect(pose?.allowFreeLook).toBe(true);
    expect(pose?.poseId).toBe('seat:test.sofa');
    expect(pose?.activePrompt).toBe('Stand Up from Test Linen Sofa');
    expect(pose?.eyePosition[1]).toBeCloseTo(-0.6 + 0.44 + 0.72, 3);
    expect(pose?.footPosition[0]).toBeCloseTo(-18.5 - 0.82, 3);
    expect(pose?.footPosition[1]).toBeCloseTo(-0.6, 3);

    // Stand up
    seat.cancelFirstPerson();
    expect(seat.isFirstPersonActive()).toBe(false);
    expect(seat.sampleFirstPersonPose()).toBeNull();
  });
});
