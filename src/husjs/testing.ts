export {
  assertNoZFighting,
  detectZFighting,
  type DetectZFightingOptions,
  type ZFightingFinding,
} from '../engine/diagnostics/z-fighting-detector.ts';

export {
  assertArchitecturalAudit,
  auditCutawayIntegrity,
  auditDoorSwings,
  auditWalkthroughReachability,
  runArchitecturalAudit,
  type ArchitecturalAuditOptions,
  type ArchitecturalAuditReport,
  type AuditCheckName,
  type AuditCheckStatus,
  type AuditCheckSummary,
  type AuditFinding,
  type AuditRoomZoneInput,
  type AuditSeverity,
  type CutawayAuditOptions,
  type DoorSwingAuditOptions,
  type WalkthroughAuditOptions,
} from '../engine/diagnostics/architectural-audit.ts';
