import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createPropertySceneLayers } from '../viewer/scene-content.ts';
import { applySelectiveBevelModifier } from './bevel-modifier.ts';

describe('applySelectiveBevelModifier', () => {
  it('bevels macro furniture/joinery boxes and cabinet carcasses while skipping sub-threshold micro-parts and hidden cores', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    const oakMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });

    const cabinetDoor = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.022), oakMat);
    cabinetDoor.name = 'kitchen.cabinetry.doorPanel';

    const cabinetPlinth = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.55), oakMat);
    cabinetPlinth.name = 'joinery.cabinetInterior.plinth';

    const microButton = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.008), oakMat);
    microButton.name = 'kitchen.espresso.button';

    const hiddenCore = new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.98, 0.044), oakMat);
    hiddenCore.name = 'joinery.solidDoorCore';

    scene.add(cabinetDoor, cabinetPlinth, microButton, hiddenCore);
    applySelectiveBevelModifier(layers);

    expect(cabinetDoor.geometry.type).toBe('RoundedBoxGeometry');
    expect(cabinetPlinth.geometry.type).toBe('RoundedBoxGeometry');
    expect(microButton.geometry.type).toBe('BoxGeometry');
    expect(hiddenCore.geometry.type).toBe('BoxGeometry');
  });
});
