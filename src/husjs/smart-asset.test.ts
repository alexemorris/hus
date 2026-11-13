import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  formatAssetDimensionsMm,
  formatAssetScheduleCsv,
  formatAssetScheduleMarkdown,
  formatAssetScheduleTable,
  resolveAssetLinks,
} from '../core/assets/asset-metadata.ts';
import {
  attachAssetInteraction,
  attachAssetMetadata,
  bindSmartAssetsInScene,
  collectSceneAssetSchedule,
  getAssetMetadata,
  resolveAssetMetadataHit,
} from '../engine/assets/smart-asset.ts';
import { InteractionRegistry } from '../engine/interaction/interaction-registry.ts';
import {
  buildLacancheCluny1000Range,
  buildSageBaristaExpress,
} from './catalog/appliances.ts';
import { buildNeptuneLarderPantry } from './catalog/architectural.ts';
import { createGeorgianSashWindow } from './objects.ts';
import {
  buildLefroyBrooksCharterhouseWc,
  buildPerrinRoweKitchenTap,
  buildThomasCrapperLowLevelWc,
} from './catalog/sanitaryware.ts';

describe('Self-Contained Smart Assets', () => {
  it('auto-discovers zero-ctx catalog smart interactions & animates hinges, drawers, and toggles on scene.add(asset)', () => {
    const scene = new THREE.Scene();

    // Zero-ctx Lacanche Cluny 1000 Range: 2 hinged oven doors + 2 sliding warming drawers
    const range = buildLacancheCluny1000Range();
    scene.add(range);

    // Zero-ctx Neptune Chichester Larder: linked double doors + internal oak drawers
    const larder = buildNeptuneLarderPantry();
    larder.position.set(2, 0, 0);
    scene.add(larder);

    // Zero-ctx Sage Barista Express + Perrin & Rowe Kitchen Tap + Thomas Crapper WC + Sash Window
    const espresso = buildSageBaristaExpress({ namePrefix: 'kitchen.espresso' });
    scene.add(espresso);

    const tap = buildPerrinRoweKitchenTap({ model: 'phoenician-bridge', finish: 'AB' });
    scene.add(tap);

    const wc = buildThomasCrapperLowLevelWc({ namePrefix: 'cloakroom.wc', finish: 'BR' });
    scene.add(wc);

    const sash = createGeorgianSashWindow({ width: 1.05, height: 1.75, label: 'Drawing Room Sash' });
    scene.add(sash.group);

    const interactiveMeshes: THREE.Object3D[] = [];
    const registry = new InteractionRegistry(interactiveMeshes);
    const bound = bindSmartAssetsInScene(scene, registry);
    expect(bound.boundInteractions).toBeGreaterThanOrEqual(10);
    expect(bound.registeredAudioEmitters).toBeGreaterThanOrEqual(2);
    expect(registry.getSmartClickableMeshes().length).toBeGreaterThan(20);

    // Re-scanning is idempotent (0 duplicate bindings)
    expect(bindSmartAssetsInScene(scene, registry).boundInteractions).toBe(0);

    // Triggering a Lacanche oven door rotates it smoothly around X without reparenting scene hierarchy
    const rangeChildCountBefore = range.children.length;
    let ovenMesh: THREE.Mesh | null = null;
    range.traverse((c) => {
      if (!ovenMesh && c instanceof THREE.Mesh && c.name.includes('ovenDoorLeft')) {
        ovenMesh = c;
      }
    });
    expect(ovenMesh).not.toBeNull();
    const ovenId = registry.getSmartInteractableIdForObject(ovenMesh!);
    expect(ovenId).toBeDefined();
    expect(registry.handleInteractableClick(ovenId!)).toBe(true);
    for (let i = 0; i < 40; i++) registry.update(0.05);
    expect(range.children.length).toBe(rangeChildCountBefore);

    // Linked double larder doors open together when either leaf is clicked
    let leftLarderMesh: THREE.Mesh | null = null;
    let rightLarderDoor: THREE.Object3D | null = null;
    larder.traverse((c) => {
      if (!leftLarderMesh && c instanceof THREE.Mesh && c.name.includes('.leftDoor.')) {
        leftLarderMesh = c;
      }
      if (!rightLarderDoor && c.name.endsWith('.rightDoor')) {
        rightLarderDoor = c;
      }
    });
    expect(leftLarderMesh).not.toBeNull();
    expect(rightLarderDoor).not.toBeNull();
    const larderDoorId = registry.getSmartInteractableIdForObject(leftLarderMesh!);
    expect(larderDoorId).toBeDefined();
    registry.handleInteractableClick(larderDoorId!);
    for (let i = 0; i < 40; i++) registry.update(0.05);
    expect(Math.abs(rightLarderDoor!.rotation.y)).toBeGreaterThan(0.5);

    // Sash window exposes live acoustic portal openness when slid open
    let sashMesh: THREE.Mesh | null = null;
    sash.lowerSashGroup.traverse((c) => {
      if (!sashMesh && c instanceof THREE.Mesh) sashMesh = c;
    });
    const sashId = registry.getSmartInteractableIdForObject(sashMesh!);
    expect(sashId).toBeDefined();
    registry.handleInteractableClick(sashId!);
    for (let i = 0; i < 40; i++) registry.update(0.05);
    const portals = registry.getExteriorDoorAcousticPortals(() => false);
    expect(portals.some((p) => p.openness > 0.9)).toBe(true);

    // Toggle auto-reset works on WC cistern flush
    let wcMesh: THREE.Mesh | null = null;
    wc.traverse((c) => {
      if (!wcMesh && c instanceof THREE.Mesh) wcMesh = c;
    });
    const wcId = registry.getSmartInteractableIdForObject(wcMesh!);
    expect(wcId).toBeDefined();
    expect(registry.handleInteractableClick(wcId!)).toBe(true);
    expect(registry.describeInteractable(wcMesh!)).toContain('Flushing');
    registry.update(3.0);
    expect(registry.describeInteractable(wcMesh!)).toContain('Flush');
  });

  it('prevents double-registration when an explicit InteractionRegistry ctx was passed to a catalog builder', () => {
    const scene = new THREE.Scene();
    const interactiveMeshes: THREE.Object3D[] = [];
    const registry = new InteractionRegistry(interactiveMeshes);
    const rangeWithCtx = buildLacancheCluny1000Range(registry);
    scene.add(rangeWithCtx);

    // Oven doors & warming drawers were already bound via explicit registry, so 0 duplicate bindings
    expect(bindSmartAssetsInScene(scene, registry).boundInteractions).toBe(0);
  });

  it('attaches rich AssetMetadata, resolves ancestor inspection hits, and generates BOM schedules', () => {
    const scene = new THREE.Scene();
    const roomGroup = new THREE.Group();
    roomGroup.userData.zoneId = 'kitchen';
    scene.add(roomGroup);

    const range = buildLacancheCluny1000Range(null, { finish: 'frenchBlue' });
    roomGroup.add(range);

    const wc1 = buildLefroyBrooksCharterhouseWc({ namePrefix: 'wc1', finish: 'NI' });
    const wc2 = buildLefroyBrooksCharterhouseWc({ namePrefix: 'wc2', finish: 'NI' });
    roomGroup.add(wc1, wc2);

    const custom = attachAssetMetadata(new THREE.Group(), {
      name: 'Custom Oak Bench',
      brand: 'Bespoke',
      sku: 'BSP-001',
      dimensionsMm: [1400, 420, 460],
      productUrl: 'https://example.com/bench',
      schematicUrl: 'https://example.com/bench.pdf',
    });
    attachAssetInteraction(custom, { kind: 'toggle', label: 'Inspect Bench' });
    roomGroup.add(custom);

    // Deep child mesh resolves up to its owning smart asset
    let deepMesh: THREE.Object3D | null = null;
    range.traverse((c) => {
      if (!deepMesh && c instanceof THREE.Mesh) deepMesh = c;
    });
    const found = resolveAssetMetadataHit(deepMesh);
    expect(found?.root).toBe(range);
    expect(found?.metadata.brand).toBe('Lacanche');
    expect(found?.metadata.productUrl).toContain('lacanche.co.uk');
    expect(formatAssetDimensionsMm(found!.metadata.dimensionsMm)).toBe('1000 × 650 × 900 mm');
    expect(resolveAssetLinks(found!.metadata).length).toBeGreaterThanOrEqual(2);
    expect(getAssetMetadata(wc1)?.brand).toBe('Lefroy Brooks');

    const schedule = collectSceneAssetSchedule(scene, {
      houseId: 'test-house',
      houseName: 'Test House',
      getZoneLabel: (z) => (z === 'kitchen' ? 'Kitchen & Dining' : z),
    });
    expect(schedule.totalPlacedAssets).toBeGreaterThanOrEqual(4);
    const wcRow = schedule.entries.find((r) => r.sku?.startsWith('CHA'));
    expect(wcRow?.quantity).toBe(2);
    expect(wcRow?.zones).toContain('Kitchen & Dining');

    const table = formatAssetScheduleTable(schedule);
    expect(table).toContain('Lacanche');

    const md = formatAssetScheduleMarkdown(schedule);
    expect(md).toContain('Test House');
    expect(md).toContain('Lacanche');
    expect(md).toContain('[Product]');

    const csv = formatAssetScheduleCsv(schedule);
    expect(csv.split('\n')[0]).toContain('sku');
    expect(csv).toContain('Lefroy Brooks');
  });
});
