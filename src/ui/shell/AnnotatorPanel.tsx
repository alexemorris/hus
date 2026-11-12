import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AnnotationKind, SceneAnnotationRecord } from '../../core/types/scene.ts';
import type { TwinMovableTarget } from '../../core/types/twin-api.ts';
import {
  activeTransformState,
  annotationTool,
  annotationsList,
  annotatorActive,
  annotatorFocusRequest,
  annotatorGizmoMode,
  liveMeasureState,
  measureAxisSnap,
  selectedAnnotationId,
} from '../../state/notes-store.ts';
import { AnnotationSummaryPill } from '../components/AnnotationSummaryPill.tsx';
import type { AnnotatorController } from '../notes/annotator-controller.ts';
import { formatMetersAndFeetInches } from '../notes/notes-export.ts';
import { Icon } from './icons.tsx';

export interface AnnotatorPanelProps {
  readonly annotator: AnnotatorController;
}

export function AnnotatorPinsOverlay({ annotator }: AnnotatorPanelProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => annotator.attachPinsHost(hostRef.current), [annotator]);

  return <div ref={hostRef} class="annotator-pins-overlay" aria-hidden="true" />;
}

function recordBadgePrefix(r: SceneAnnotationRecord): string {
  const kind: AnnotationKind = r.kind ?? 'pin';
  if (kind === 'move' && r.objectTransform) {
    const [dx, dy, dz] = r.objectTransform.deltaTranslation;
    const [drx, dry, drz] = r.objectTransform.deltaRotationDeg;
    const hasMove = Math.hypot(dx, dy, dz) >= 0.002;
    const hasRot = Math.hypot(drx, dry, drz) >= 0.1;
    return hasMove && hasRot ? 'MOVE+ROT ' : hasRot ? 'ROTATE ' : 'MOVE ';
  }
  if (kind === 'measure') return 'SPAN ';
  return '';
}

function recordCoordsSummary(r: SceneAnnotationRecord): string {
  const kind: AnnotationKind = r.kind ?? 'pin';
  if (kind === 'move' && r.objectTransform) {
    const [dx, dy, dz] = r.objectTransform.deltaTranslation;
    const [drx, dry, drz] = r.objectTransform.deltaRotationDeg;
    const hasMove = Math.hypot(dx, dy, dz) >= 0.002;
    const hasRot = Math.hypot(drx, dry, drz) >= 0.1;
    return hasMove
      ? `Δ[${dx}, ${dy}, ${dz}]m${hasRot ? ` · ${dry}°` : ''}`
      : `ΔRotY ${dry >= 0 ? '+' : ''}${dry}°`;
  }
  if (kind === 'measure' && r.measurement) {
    const m = r.measurement;
    const tgt = m.targetMeasurement?.trim();
    return tgt ? `${m.distanceM}m → ${tgt}` : `${m.distanceM}m`;
  }
  const [x, y, z] = r.worldPoint;
  return `${x}, ${y}, ${z}`;
}

export function AnnotatorPanel({ annotator }: AnnotatorPanelProps): JSX.Element {
  const isActive = annotatorActive.value;
  const tool = annotationTool.value;
  const gizmoMode = annotatorGizmoMode.value;
  const axisSnap = measureAxisSnap.value;
  const records = annotationsList.value;
  const selectedId = selectedAnnotationId.value;
  const activeTf = activeTransformState.value;
  const liveMeasure = liveMeasureState.value;
  const focusReq = annotatorFocusRequest.value;

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const noteInputRef = useRef<HTMLInputElement | null>(null);
  const targetInputRef = useRef<HTMLInputElement | null>(null);
  const dxRef = useRef<HTMLInputElement | null>(null);
  const dyRef = useRef<HTMLInputElement | null>(null);
  const dzRef = useRef<HTMLInputElement | null>(null);
  const dRotYRef = useRef<HTMLInputElement | null>(null);

  const selected =
    selectedId !== null ? records.find((r) => r.id === selectedId) ?? null : null;
  const isOpen = isActive || selected !== null;

  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return;
    const body = document.body;
    body.classList.toggle('is-annotating', isActive);
    return () => {
      body.classList.remove('is-annotating');
    };
  }, [isActive]);

  useEffect(() => {
    if (!focusReq) return;
    const timer = setTimeout(() => {
      const el =
        focusReq.field === 'target' ? targetInputRef.current : noteInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }, 20);
    return () => clearTimeout(timer);
  }, [focusReq]);

  const toolLabel =
    tool === 'move'
      ? 'Move Object'
      : tool === 'rotate'
        ? 'Rotate Object'
        : tool === 'measure'
          ? 'Measure Span'
          : 'Pin Issue';

  const showMoveBox =
    (isActive && (tool === 'move' || tool === 'rotate')) || selected?.kind === 'move';
  const tf = activeTf?.transform ?? selected?.objectTransform ?? null;
  const moveCandidates: readonly TwinMovableTarget[] =
    activeTf && activeTf.candidates.length > 0
      ? activeTf.candidates
      : tf
        ? [
            {
              uuid: tf.targetUuid,
              label: `${tf.targetKind === 'group' ? 'Group' : 'Mesh'}: ${tf.targetName}`,
              kind: tf.targetKind,
            },
          ]
        : [];

  const showMeasureBox =
    (isActive && tool === 'measure') || selected?.kind === 'measure';

  const applyNumericMoveInputs = (): void => {
    const dx = Number.parseFloat(dxRef.current?.value ?? '0') || 0;
    const dy = Number.parseFloat(dyRef.current?.value ?? '0') || 0;
    const dz = Number.parseFloat(dzRef.current?.value ?? '0') || 0;
    const dRotY = Number.parseFloat(dRotYRef.current?.value ?? '0') || 0;
    annotator.setSelectedDelta(dx, dy, dz, dRotY);
  };

  let editorTitle = '';
  let editorCoords = '';
  let editorMesh = '';
  if (selected) {
    const kind: AnnotationKind = selected.kind ?? 'pin';
    const [x, y, z] = selected.worldPoint;
    const [nx, ny, nz] = selected.worldNormal;
    if (kind === 'move' && selected.objectTransform) {
      const otf = selected.objectTransform;
      const [dx, dy, dz] = otf.deltaTranslation;
      const [drx, dry, drz] = otf.deltaRotationDeg;
      const hasMove = Math.hypot(dx, dy, dz) >= 0.002;
      const hasRot = Math.hypot(drx, dry, drz) >= 0.1;
      const labelWord = hasMove && hasRot ? 'MOVE+ROT' : hasRot ? 'ROTATE' : 'MOVE';
      editorTitle = `${labelWord} #${selected.id} · ${selected.roomName.toUpperCase()}`;
      editorCoords = hasMove
        ? `Δ[${otf.deltaTranslation.join(', ')}]m${hasRot ? ` · ΔRotY ${dry}°` : ''}`
        : `ΔRot[${drx}°, ${dry}°, ${drz}°]`;
      editorMesh = `${otf.targetName} · [${otf.initialWorldCenter.join(', ')}] → [${otf.newWorldCenter.join(', ')}] · Rot=[${otf.newRotationDeg.join('°, ')}°]`;
    } else if (kind === 'measure' && selected.measurement) {
      const m = selected.measurement;
      const targetText = m.targetMeasurement?.trim()
        ? ` → Target: ${m.targetMeasurement.trim()}`
        : '';
      editorTitle = `SPAN #${selected.id} · ${selected.roomName.toUpperCase()}`;
      editorCoords = `${m.distanceM.toFixed(3)}m${targetText}`;
      editorMesh = `A [${m.startPoint.join(', ')}] → B [${m.endPoint.join(', ')}] · Δ[${m.deltaXYZ.join(', ')}]m`;
    } else {
      editorTitle = `PIN #${selected.id} · ${selected.roomName.toUpperCase()}`;
      editorCoords = `[${x}, ${y}, ${z}]`;
      editorMesh = `${selected.meshInfo.meshName} · ${selected.meshInfo.geometrySummary} · n=[${nx}, ${ny}, ${nz}]`;
    }
  }

  const clampedRotY = tf
    ? Math.max(-180, Math.min(180, Math.round(tf.deltaRotationDeg[1])))
    : 0;
  const dRy = tf ? tf.deltaRotationDeg[1] : 0;

  return (
    <aside
      class={`shell-inspector shell-glass annotator-panel${isOpen ? ' is-open' : ''}`}
      aria-label="Note and measure inspector"
    >
      <header class="shell-inspector-head is-static">
        <span class="shell-inspector-title">Notes &amp; measurements</span>
        <span class="shell-pill">{records.length}</span>
        <button
          class="shell-icon-btn shell-icon-btn-sm"
          type="button"
          title="Close (Esc)"
          aria-label="Close inspector"
          onClick={(e) => {
            e.stopPropagation();
            annotator.closeInspector();
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </header>

      <div class="hud-body annotator-body">
        <section class="hud-section hud-section-last">
          <div class="annotator-top-row">
            <button
              class={`hud-rocker-btn annotator-mode-btn${isActive ? ' is-active-mode' : ''}`}
              type="button"
              title="Toggle 3D Annotation Mode (Shortcut: Key 'A' or Shift+Click any surface)"
              onClick={() => annotator.toggleAnnotateMode()}
            >
              <span class={`hud-rocker-dot${!isActive ? ' off-state' : ''}`} />
              <span class="hud-rocker-label">
                {isActive ? `Annotate: ON · ${toolLabel}` : 'Annotate Mode: OFF'}
              </span>
              <span class="hud-rocker-hint">Shift+Click / A</span>
            </button>
          </div>

          <div class="annotator-tools-bar" role="group" aria-label="Annotate Tool Mode">
            <button
              class={`annotator-tool-btn kind-pin${tool === 'pin' ? ' is-active' : ''}`}
              type="button"
              title="Pin Issue Tool (Shortcut: P) — Click any 3D surface to drop a numbered issue pin"
              onClick={() => annotator.selectTool('pin', true)}
            >
              Pin (P)
            </button>
            <button
              class={`annotator-tool-btn kind-move${tool === 'move' ? ' is-active' : ''}`}
              type="button"
              title="Move Object Tool (Shortcut: M or W) — Click any 3D furniture/fixture to drag with 3D translation gizmo or nudge coordinates"
              onClick={() => annotator.selectTool('move', true)}
            >
              Move (M)
            </button>
            <button
              class={`annotator-tool-btn kind-rotate${tool === 'rotate' ? ' is-active' : ''}`}
              type="button"
              title="Rotate Object Tool (Shortcut: E) — Click any 3D furniture/fixture to rotate with 3D rotation rings or angle controls"
              onClick={() => annotator.selectTool('rotate', true)}
            >
              Rotate (E)
            </button>
            <button
              class={`annotator-tool-btn kind-measure${tool === 'measure' ? ' is-active' : ''}`}
              type="button"
              title="3D Measure Span Tool (Shortcut: R) — Click Point A then Point B to measure distance and record real-world target dimension"
              onClick={() => annotator.selectTool('measure', true)}
            >
              Measure (R)
            </button>
          </div>

          <div class="annotator-actions-row">
            <button
              class="hud-action-btn annotator-copy-btn"
              type="button"
              title="Copy all annotations (Pins, Object Moves/Rotations, and Measurements) as Markdown + JSON to paste into chat"
              onClick={() => {
                void annotator.copyForAgent().then((ok) => {
                  setCopyFeedback(ok ? 'Copied for Agent' : 'Copied');
                  window.setTimeout(() => setCopyFeedback(null), 1800);
                });
              }}
            >
              {copyFeedback ?? 'Copy for Agent'}
            </button>
            <button
              class="hud-inline-btn"
              type="button"
              title="Download annotations & transforms as JSON"
              onClick={() => annotator.exportJson()}
            >
              Export JSON
            </button>
            <button
              class="hud-inline-btn"
              type="button"
              title="Clear all 3D annotations"
              onClick={() => annotator.clearAll()}
            >
              Clear
            </button>
          </div>

          {showMoveBox && (
            <div class="annotator-sub-box annotator-move-box">
              <div class="annotator-sub-head">
                <span class="annotator-sub-title">
                  {gizmoMode === 'rotate' ? 'ROTATE / MOVE OBJECT' : 'MOVE / ROTATE OBJECT'}
                </span>
                <div class="annotator-gizmo-switch">
                  <button
                    class={`hud-inline-btn${gizmoMode === 'translate' ? ' is-active' : ''}`}
                    type="button"
                    title="3D Translate Gizmo (Shortcut: M or W)"
                    onClick={() => annotator.selectTool('move', true)}
                  >
                    Move (W)
                  </button>
                  <button
                    class={`hud-inline-btn${gizmoMode === 'rotate' ? ' is-active' : ''}`}
                    type="button"
                    title="3D Rotate Gizmo (Shortcut: E)"
                    onClick={() => annotator.selectTool('rotate', true)}
                  >
                    Rotate (E)
                  </button>
                </div>
              </div>

              {!tf ? (
                <div class="annotator-sub-hint">
                  Click any 3D furniture, appliance, door, or fixture to attach the 3D Move / Rotate gizmo and drag or adjust it.
                </div>
              ) : (
                <div>
                  <div class="annotator-move-row">
                    <label class="annotator-field-label">
                      Target
                      <select
                        class="hud-select annotator-move-select"
                        title="Choose whether to move/rotate the whole parent furniture group or an individual child mesh"
                        value={tf.targetUuid}
                        onChange={(e) => annotator.switchMoveCandidate(e.currentTarget.value)}
                      >
                        {moveCandidates.map((c) => (
                          <option key={c.uuid} value={c.uuid}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div class="annotator-move-grid">
                    <label class="annotator-num-field">
                      <span>ΔX (m)</span>
                      <input
                        ref={dxRef}
                        type="number"
                        step="0.05"
                        value={String(tf.deltaTranslation[0])}
                        onChange={applyNumericMoveInputs}
                      />
                    </label>
                    <label class="annotator-num-field">
                      <span>ΔY (m)</span>
                      <input
                        ref={dyRef}
                        type="number"
                        step="0.05"
                        value={String(tf.deltaTranslation[1])}
                        onChange={applyNumericMoveInputs}
                      />
                    </label>
                    <label class="annotator-num-field">
                      <span>ΔZ (m)</span>
                      <input
                        ref={dzRef}
                        type="number"
                        step="0.05"
                        value={String(tf.deltaTranslation[2])}
                        onChange={applyNumericMoveInputs}
                      />
                    </label>
                    <label class="annotator-num-field">
                      <span>ΔRot Y (°)</span>
                      <input
                        ref={dRotYRef}
                        type="number"
                        step="15"
                        value={String(tf.deltaRotationDeg[1])}
                        onChange={applyNumericMoveInputs}
                      />
                    </label>
                  </div>

                  <div class="annotator-rot-slider-row">
                    <span class="annotator-field-label">Yaw Y°</span>
                    <input
                      class="annotator-rot-slider"
                      type="range"
                      min="-180"
                      max="180"
                      step="1"
                      aria-label="Yaw Y degrees"
                      value={String(clampedRotY)}
                      onInput={(e) => {
                        const nextRotY = Number.parseFloat(e.currentTarget.value) || 0;
                        const dx = tf.deltaTranslation[0];
                        const dy = tf.deltaTranslation[1];
                        const dz = tf.deltaTranslation[2];
                        annotator.setSelectedDelta(dx, dy, dz, nextRotY);
                      }}
                    />
                    <span class="annotator-rot-readout">
                      {dRy >= 0 ? `+${dRy}°` : `${dRy}°`}
                    </span>
                  </div>

                  <div class="annotator-nudge-bar">
                    <button class="hud-inline-btn" type="button" title="Nudge West (-X 5cm)" onClick={() => annotator.nudgeSelected(-0.05, 0, 0, 0)}>-X</button>
                    <button class="hud-inline-btn" type="button" title="Nudge East (+X 5cm)" onClick={() => annotator.nudgeSelected(0.05, 0, 0, 0)}>+X</button>
                    <button class="hud-inline-btn" type="button" title="Nudge North (-Z 5cm)" onClick={() => annotator.nudgeSelected(0, 0, -0.05, 0)}>-Z</button>
                    <button class="hud-inline-btn" type="button" title="Nudge South (+Z 5cm)" onClick={() => annotator.nudgeSelected(0, 0, 0.05, 0)}>+Z</button>
                    <button class="hud-inline-btn" type="button" title="Nudge Down (-Y 2cm)" onClick={() => annotator.nudgeSelected(0, -0.02, 0, 0)}>-Y</button>
                    <button class="hud-inline-btn" type="button" title="Nudge Up (+Y 2cm)" onClick={() => annotator.nudgeSelected(0, 0.02, 0, 0)}>+Y</button>
                  </div>

                  <div class="annotator-nudge-bar">
                    <button class="hud-inline-btn" type="button" title="Rotate -90° around Y" onClick={() => annotator.nudgeSelected(0, 0, 0, -90)}>-90°</button>
                    <button class="hud-inline-btn" type="button" title="Rotate -45° around Y" onClick={() => annotator.nudgeSelected(0, 0, 0, -45)}>-45°</button>
                    <button class="hud-inline-btn" type="button" title="Rotate -15° around Y" onClick={() => annotator.nudgeSelected(0, 0, 0, -15)}>-15°</button>
                    <button class="hud-inline-btn" type="button" title="Rotate +15° around Y" onClick={() => annotator.nudgeSelected(0, 0, 0, 15)}>+15°</button>
                    <button class="hud-inline-btn" type="button" title="Rotate +45° around Y" onClick={() => annotator.nudgeSelected(0, 0, 0, 45)}>+45°</button>
                    <button class="hud-inline-btn" type="button" title="Rotate +90° around Y" onClick={() => annotator.nudgeSelected(0, 0, 0, 90)}>+90°</button>
                    <button class="hud-inline-btn" type="button" title="Rotate 180° around Y" onClick={() => annotator.nudgeSelected(0, 0, 0, 180)}>180°</button>
                    <button
                      class="hud-inline-btn annotator-reset-btn"
                      type="button"
                      title="Reset object to original position and rotation"
                      onClick={() => annotator.resetSelectedMove()}
                    >
                      Reset
                    </button>
                  </div>

                  <div class="annotator-editor-meta">
                    {`Center: [${tf.initialWorldCenter.join(', ')}] → [${tf.newWorldCenter.join(', ')}] · Rot: [${tf.newRotationDeg.join('°, ')}°]`}
                  </div>
                </div>
              )}
            </div>
          )}

          {showMeasureBox && (
            <div class="annotator-sub-box annotator-measure-box">
              <div class="annotator-sub-head">
                <span class="annotator-sub-title">3D MEASURE SPAN</span>
                <div class="annotator-measure-opts">
                  <label
                    class="annotator-snap-label"
                    title="Lock measurement line parallel to dominant X, Y, or Z axis (or hold Shift while measuring)"
                  >
                    <input
                      type="checkbox"
                      checked={liveMeasure?.axisSnapLocked ?? axisSnap}
                      onChange={(e) => annotator.setMeasureAxisSnap(e.currentTarget.checked)}
                    />
                    <span>Axis Snap</span>
                  </label>
                  {liveMeasure?.active && (
                    <button
                      class="hud-inline-btn"
                      type="button"
                      title="Cancel active measurement point"
                      onClick={() => annotator.cancelMeasurement()}
                    >
                      Cancel Pt A
                    </button>
                  )}
                </div>
              </div>

              {liveMeasure?.active ? (
                liveMeasure.currentEndPoint &&
                liveMeasure.distanceM !== null &&
                liveMeasure.deltaXYZ ? (
                  <>
                    <div class="annotator-measure-status">
                      Click <strong>Point B</strong> to save span annotation (hold <strong>Shift</strong> for axis snap).
                    </div>
                    <div class="annotator-measure-readout">
                      <div class="annotator-measure-primary">
                        <span class="annotator-measure-val">
                          {`${liveMeasure.distanceM.toFixed(3)} m`}
                        </span>
                        <span class="annotator-measure-sub">
                          {`${(liveMeasure.distanceM * 100).toFixed(1)} cm · Horiz ${liveMeasure.horizontalDistanceM?.toFixed(3) ?? '0.000'} m`}
                        </span>
                      </div>
                      <div class="annotator-editor-meta">
                        {`Pt A [${liveMeasure.startPoint?.join(', ')}] → Pt B [${liveMeasure.currentEndPoint.join(', ')}] · ΔX=${liveMeasure.deltaXYZ[0]}m, ΔY=${liveMeasure.deltaXYZ[1]}m, ΔZ=${liveMeasure.deltaXYZ[2]}m`}
                      </div>
                    </div>
                  </>
                ) : (
                  <div class="annotator-measure-status">
                    Point A locked at <code>[{liveMeasure.startPoint?.join(', ')}]</code> — move cursor and click <strong>Point B</strong>.
                  </div>
                )
              ) : selected?.kind === 'measure' && selected.measurement ? (
                <>
                  <div class="annotator-measure-status">
                    {isActive && tool === 'measure' ? (
                      <>
                        Showing selected span. Click any 3D surface to start a new <strong>Point A</strong>.
                      </>
                    ) : (
                      <>
                        Measured span between <code>{selected.measurement.startMeshName}</code> and <code>{selected.measurement.endMeshName}</code>:
                      </>
                    )}
                  </div>
                  <div class="annotator-measure-readout">
                    <div class="annotator-measure-primary">
                      <span class="annotator-measure-val">
                        {`${selected.measurement.distanceM.toFixed(3)} m`}
                      </span>
                      <span class="annotator-measure-sub">
                        {formatMetersAndFeetInches(selected.measurement.distanceM)}
                      </span>
                    </div>
                    <div class="annotator-editor-meta">
                      {`A [${selected.measurement.startPoint.join(', ')}] → B [${selected.measurement.endPoint.join(', ')}] · ΔX=${selected.measurement.deltaXYZ[0]}m, ΔY=${selected.measurement.deltaXYZ[1]}m, ΔZ=${selected.measurement.deltaXYZ[2]}m`}
                    </div>
                  </div>
                  <div class="annotator-measure-target-row">
                    <span class="annotator-field-label">Real / Target</span>
                    <input
                      ref={targetInputRef}
                      class="hud-ai-input annotator-target-input"
                      type="text"
                      placeholder="e.g. 2.45m or 2450mm (real-life measurement)"
                      aria-label="Real or target measurement to correct model"
                      value={selected.measurement.targetMeasurement ?? ''}
                      onInput={(e) =>
                        annotator.updateTargetMeasurement(selected.id, e.currentTarget.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          noteInputRef.current?.focus();
                        }
                      }}
                    />
                  </div>
                </>
              ) : (
                <div class="annotator-measure-status">
                  Click <strong>Point A</strong> on any 3D wall, floor, or cabinet, then click <strong>Point B</strong> to measure span.
                </div>
              )}
            </div>
          )}

          {selected && (
            <div class="annotator-editor-box">
              <div class="annotator-editor-head">
                <span class="annotator-editor-title">{editorTitle}</span>
                <span class="annotator-editor-coords">{editorCoords}</span>
              </div>
              <div class="annotator-editor-meta">{editorMesh}</div>
              <input
                ref={noteInputRef}
                class="hud-ai-input annotator-note-input"
                type="text"
                placeholder="Add note / instructions for this annotation (Enter to save)..."
                aria-label="Annotation issue note"
                value={selected.note}
                onInput={(e) => annotator.updateNote(selected.id, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
            </div>
          )}

          <div class="annotator-reactive-summary">
            <AnnotationSummaryPill />
          </div>

          <div class="annotator-list">
            {records.length === 0 ? (
              <div class="annotator-empty">
                Toggle <strong>Annotate Mode</strong> (or <strong>Shift + Click</strong>) and choose <strong>Pin</strong>, <strong>Move</strong>, <strong>Rotate</strong>, or <strong>Measure</strong> to record issues, object movements/rotations, or span measurements.
              </div>
            ) : (
              records.map((r) => {
                const kind: AnnotationKind = r.kind ?? 'pin';
                const isSel = r.id === selectedId;
                const noteText =
                  kind === 'measure' && r.measurement
                    ? r.note.trim() ||
                      (r.measurement.targetMeasurement?.trim()
                        ? `Span ${r.measurement.distanceM}m → Real/Target: ${r.measurement.targetMeasurement.trim()}`
                        : `Measured span: ${r.measurement.distanceM}m (${(r.measurement.distanceM * 100).toFixed(1)}cm)`)
                    : r.note.trim() || '(Click to add description...)';
                const metaText =
                  kind === 'move' && r.objectTransform
                    ? `${r.objectTransform.targetName} · [${r.objectTransform.initialWorldCenter.join(', ')}] → [${r.objectTransform.newWorldCenter.join(', ')}]`
                    : kind === 'measure' && r.measurement
                      ? `A [${r.measurement.startPoint.join(', ')}] → B [${r.measurement.endPoint.join(', ')}] · Δ[${r.measurement.deltaXYZ.join(', ')}]m`
                      : `${r.meshInfo.meshName} · ${r.meshInfo.geometrySummary}`;

                return (
                  <div
                    key={r.id}
                    class={`annotator-item kind-${kind}${isSel ? ' is-selected' : ''}`}
                    onClick={() => annotator.focusRecord(r.id)}
                  >
                    <div class="annotator-item-head">
                      <span class={`annotator-item-badge kind-${kind}`}>
                        {`${recordBadgePrefix(r)}#${r.id}`}
                      </span>
                      <span class="annotator-item-room">{r.roomName}</span>
                      <span class="annotator-item-coords">{recordCoordsSummary(r)}</span>
                      <button
                        type="button"
                        class="hud-inline-btn annotator-item-btn"
                        title="Fly camera to this annotation view"
                        onClick={(e) => {
                          e.stopPropagation();
                          annotator.flyToRecord(r.id);
                        }}
                      >
                        Fly
                      </button>
                      <button
                        type="button"
                        class="hud-inline-btn annotator-item-btn annotator-del-btn"
                        title={
                          kind === 'move'
                            ? 'Delete this move annotation and restore original object position'
                            : 'Delete this annotation'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          annotator.removeRecord(r.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div class="annotator-item-note">{noteText}</div>
                    <div class="annotator-item-meta">{metaText}</div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
