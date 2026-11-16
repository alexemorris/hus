import { render } from 'preact';
import { describe, expect, it } from 'vitest';
import type { RoomManifestEntry } from '../../core/types/twin-ux.ts';
import type { RoomVariationGroupInfo } from '../../core/types/variations.ts';
import { mountHusShell } from './mount-shell.tsx';
import { createFakeTwinApi, flushMicrotasks, installFakeDom } from './shell-test-harness.ts';

const GALLERY_ROOM: RoomManifestEntry = {
  zoneId: 'gallery',
  label: 'Gallery',
  group: 'house-first',
  floor: 'first',
  lights: [],
  scenes: [],
  devices: [],
};

function makeVariationsApi(variations: readonly RoomVariationGroupInfo[]) {
  return createFakeTwinApi({
    floors: [
      { id: 'ground', label: 'Ground', elevationY: 0 },
      { id: 'first', label: 'First', elevationY: 2.8 },
    ],
    floorViewMode: 'first',
    ceilingCutaway: true,
    timeOfDay: 'day',
    ambientLux: 50,
    customDevices: [],
    terrainSculpt: false,
    rooms: {
      current: 'gallery',
      list: [GALLERY_ROOM],
      navTree: [{ id: 'house-first', label: 'First Floor', rooms: [GALLERY_ROOM] }],
    },
    variations,
  });
}

describe('Viewer Variations UI (<TopBarVariationsButton />, <VariationsPopover />, <RoomVariationsSection />)', () => {
  it('renders nothing when house has 0 variations, and renders TopBar button, popover & inline RoomPanel pills when variations > 0', async () => {
    const dom = installFakeDom();

    try {
      // Zero variations renders no variation controls anywhere
      const rootEmpty = dom.document.createElement('div');
      dom.document.body.appendChild(rootEmpty);
      const { api: emptyApi } = makeVariationsApi([]);
      const emptyCtl = mountHusShell(
        { api: emptyApi, bindKeyboard: false },
        rootEmpty as unknown as HTMLElement
      );
      expect(rootEmpty.querySelector('.shell-var-topbar-btn')).toBeNull();
      expect(rootEmpty.querySelector('.shell-card-variations')).toBeNull();
      expect(rootEmpty.querySelector('.shell-nav-var')).toBeNull();
      emptyCtl.dispose();
      render(null, rootEmpty as unknown as HTMLElement);

      // Single variation group linked to 'gallery'
      const rootWithVars = dom.document.createElement('div');
      dom.document.body.appendChild(rootWithVars);
      const { api: varApi } = makeVariationsApi([
        {
          id: 'gallery-east-wall',
          label: 'Gallery — East Wall',
          zoneId: 'gallery',
          defaultOptionId: 'shelves',
          activeOptionId: 'shelves',
          options: [
            { id: 'shelves', label: 'Open Shelves', description: 'Floating oak shelves' },
            { id: 'cupboards', label: 'Full Cupboards', description: 'Flush panelled cupboards' },
          ],
        },
      ]);
      const varCtl = mountHusShell(
        { api: varApi, bindKeyboard: false },
        rootWithVars as unknown as HTMLElement
      );

      // TopBar variations button, RoomNavigator badge, and inline RoomPanel card all render
      const topBtn = rootWithVars.querySelector('.shell-var-topbar-btn');
      expect(topBtn).not.toBeNull();
      expect(rootWithVars.querySelector('.shell-nav-var')).not.toBeNull();
      const inlineCard = rootWithVars.querySelector('.shell-card-variations');
      expect(inlineCard).not.toBeNull();
      expect(inlineCard?.textContent).toContain('Open Shelves');
      expect(inlineCard?.textContent).toContain('Full Cupboards');

      // Clicking "Full Cupboards" pill updates active variation option
      const pills = inlineCard?.querySelectorAll('.shell-var-pill') ?? [];
      expect(pills).toHaveLength(2);
      pills[1]!.dispatchClick();
      await flushMicrotasks();
      expect(varApi.variations?.getActiveOptionId('gallery-east-wall')).toBe('cupboards');
      expect(topBtn?.textContent).toBe('1');
      expect(topBtn?.getAttribute('title')).toContain('Full Cupboards');
      expect(topBtn?.getAttribute('aria-label')).toContain('Full Cupboards');

      // Clicking TopBar button opens popover, and selecting an option inside the popover auto-closes it
      topBtn!.dispatchClick();
      await flushMicrotasks();
      const pop = rootWithVars.querySelector('.shell-var-popover');
      expect(pop).not.toBeNull();
      const popPills = pop?.querySelectorAll('.shell-var-pill') ?? [];
      expect(popPills).toHaveLength(2);
      popPills[0]!.dispatchClick();
      await flushMicrotasks();
      expect(varApi.variations?.getActiveOptionId('gallery-east-wall')).toBe('shelves');
      expect(rootWithVars.querySelector('.shell-var-popover')).toBeNull();

      varCtl.dispose();
      render(null, rootWithVars as unknown as HTMLElement);
    } finally {
      dom.restore();
    }
  });
});
