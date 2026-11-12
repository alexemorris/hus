import { formatMetersAndFeetInches, type SceneAnnotationRecord } from '../../core/types/scene.ts';
import {
  formatAnnotationsForAgent,
  notesExportFilename,
} from './scoped-annotations.ts';

export {
  formatAnnotationsForAgent,
  formatMetersAndFeetInches,
  notesExportFilename,
};

/** Browser helpers for copying / downloading note exports (no engine access). */

export function copyTextWithFallback(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => execCommandCopyFallback(text));
  }
  return Promise.resolve(execCommandCopyFallback(text));
}

function execCommandCopyFallback(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export function downloadBlobFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Minimal slice of `TwinApi.notes` needed to build exports. */
export interface NotesExportSource {
  getRecords(): readonly SceneAnnotationRecord[];
  formatForAgent(): string;
  getHouseId?(): string;
  getHouseName?(): string;
}

export interface NotesExportOptions {
  readonly houseId?: string;
  readonly houseName?: string;
}

export function buildNotesJsonPayload(
  notes: NotesExportSource,
  options?: NotesExportOptions
): {
  readonly houseId: string;
  readonly houseName?: string;
  readonly exportedAt: string;
  readonly count: number;
  readonly markdownReport: string;
  readonly annotations: readonly SceneAnnotationRecord[];
} {
  const records = notes.getRecords();
  const houseId = options?.houseId ?? notes.getHouseId?.() ?? 'house';
  const houseName = options?.houseName ?? notes.getHouseName?.();
  const markdownReport = houseName
    ? formatAnnotationsForAgent(records, houseName)
    : notes.formatForAgent();

  return {
    houseId,
    ...(houseName ? { houseName } : {}),
    exportedAt: new Date().toISOString(),
    count: records.length,
    markdownReport,
    annotations: records,
  };
}

export function downloadNotesJson(
  notes: NotesExportSource,
  options?: NotesExportOptions
): void {
  const payload = buildNotesJsonPayload(notes, options);
  downloadBlobFile(
    JSON.stringify(payload, null, 2),
    notesExportFilename(payload.houseId, 'json'),
    'application/json'
  );
}
