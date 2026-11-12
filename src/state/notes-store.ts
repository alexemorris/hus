import { computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type {
  AnnotationToolMode,
  LiveMeasurePreviewState,
  SceneAnnotationHit,
  SceneAnnotationRecord,
  SceneObjectTransformAnnotation,
} from '../core/types/scene.ts';
import type { TwinMovableTarget } from '../core/types/twin-api.ts';

/**
 * Notes / measure / object-transform state, mirrored from the twin by
 * `AnnotatorController` (`src/ui/notes`) so Preact components inside `<HusShell />`
 * render reactively with zero hardcoded DOM IDs or engine polling.
 */

export interface ActiveTransformState {
  readonly baseHit: SceneAnnotationHit;
  readonly transform: SceneObjectTransformAnnotation;
  readonly candidates: readonly TwinMovableTarget[];
}

export interface AnnotatorFocusRequest {
  readonly field: 'note' | 'target';
  readonly nonce: number;
}

export const annotatorActive: Signal<boolean> = signal<boolean>(false);
export const annotationTool: Signal<AnnotationToolMode> = signal<AnnotationToolMode>('pin');
export const annotatorGizmoMode: Signal<'translate' | 'rotate'> = signal<'translate' | 'rotate'>('translate');
export const measureAxisSnap: Signal<boolean> = signal<boolean>(false);
export const activeTransformState: Signal<ActiveTransformState | null> =
  signal<ActiveTransformState | null>(null);
export const liveMeasureState: Signal<LiveMeasurePreviewState | null> =
  signal<LiveMeasurePreviewState | null>(null);
export const annotationsList: Signal<readonly SceneAnnotationRecord[]> =
  signal<readonly SceneAnnotationRecord[]>([]);
export const selectedAnnotationId: Signal<number | null> = signal<number | null>(null);
export const annotatorFocusRequest: Signal<AnnotatorFocusRequest | null> =
  signal<AnnotatorFocusRequest | null>(null);

let focusNonceSeq = 0;
export function requestAnnotatorFieldFocus(field: 'note' | 'target'): void {
  focusNonceSeq += 1;
  annotatorFocusRequest.value = { field, nonce: focusNonceSeq };
}

export interface AnnotationCounts {
  readonly total: number;
  readonly pins: number;
  readonly moves: number;
  readonly measures: number;
}

export const annotationCountsByKind: ReadonlySignal<AnnotationCounts> = computed(() => {
  const list = annotationsList.value;
  let pins = 0;
  let moves = 0;
  let measures = 0;
  for (const r of list) {
    const kind = r.kind ?? 'pin';
    if (kind === 'move') moves += 1;
    else if (kind === 'measure') measures += 1;
    else pins += 1;
  }
  return { total: list.length, pins, moves, measures };
});
