import type * as THREE from 'three';
import type { TradeView } from '../../../core/types/twin-ux.ts';
import { TradeViewController, classifyScene } from '../../trade-views/index.ts';
import { Emitter } from '../../util/emitter.ts';
import type { RenderInvalidator } from './viewer-types.ts';

/** Trade (owner / architect / builder / electrician / plumber) view state. */
export class TradeViewService {
  public readonly changed = new Emitter<[view: TradeView]>();
  public readonly controller: TradeViewController;
  private readonly invalidator: RenderInvalidator;
  private readonly onSyncBatchForTradeView?: (shouldBatch: boolean) => void;
  private view: TradeView = 'owner';

  public constructor(
    scene: THREE.Scene,
    invalidator: RenderInvalidator,
    onSyncBatchForTradeView?: (shouldBatch: boolean) => void
  ) {
    this.invalidator = invalidator;
    this.onSyncBatchForTradeView = onSyncBatchForTradeView;
    // Tag every renderable and capture service points before static batching merges sub-parts.
    classifyScene([scene]);
    this.controller = new TradeViewController({
      roots: [scene],
      requestRender: () => invalidator.requestRender(),
      invalidateShadows: () => invalidator.invalidateShadows(),
    });
    this.controller.captureServicePoints();
  }

  public getView(): TradeView {
    return this.view;
  }

  public setView(view: TradeView): void {
    if (view === this.view) return;
    this.view = view;
    if (view !== 'owner') {
      // Unbatch on-demand so trade highlighting/ghosting/hiding applies per individual classified mesh.
      this.onSyncBatchForTradeView?.(false);
      this.controller.setView(view);
    } else {
      // Restore original materials first, then re-batch cleanly for full runtime draw-call collapse.
      this.controller.setView('owner');
      this.onSyncBatchForTradeView?.(true);
    }
    this.changed.emit(view);
    this.invalidator.requestRender();
  }

  /** CSV schedule of service points (sockets, switches, sanitaryware, …) for a trade. */
  public exportServiceSchedule(view: TradeView = this.view): string {
    return this.controller.exportServiceScheduleCsv(view);
  }
}
