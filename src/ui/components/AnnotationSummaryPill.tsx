import { render, type JSX } from 'preact';
import {
  annotationCountsByKind,
  annotationTool,
  annotatorActive,
  selectedAnnotationId,
} from '../../state/notes-store.ts';

export function AnnotationSummaryPill(): JSX.Element {
  const isActive = annotatorActive.value;
  const tool = annotationTool.value;
  const counts = annotationCountsByKind.value;
  const selectedId = selectedAnnotationId.value;

  return (
    <div
      className="annotator-summary-pill-bar"
      role="status"
      aria-live="polite"
    >
      <span className={`annotator-summary-tag${isActive ? ' is-active' : ''}`}>
        {isActive ? `TOOL: ${tool.toUpperCase()}` : 'IDLE'}
      </span>
      <div className="annotator-summary-counts">
        <span className="annotator-summary-tag" title="Surface Issue Pins">
          {counts.pins} Pin
        </span>
        <span className="annotator-summary-tag" title="Moved / Rotated Objects">
          {counts.moves} Move
        </span>
        <span className="annotator-summary-tag" title="Measured 3D Spans">
          {counts.measures} Span
        </span>
        {selectedId !== null ? (
          <span className="annotator-summary-tag is-active">#{selectedId}</span>
        ) : null}
      </div>
    </div>
  );
}

export function mountAnnotationSummaryPill(container: HTMLElement): void {
  render(<AnnotationSummaryPill />, container);
}
