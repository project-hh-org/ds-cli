export type {
  ComponentPlanSummary,
  ComponentSkipReason,
  FilePlan,
  MigrateOptions,
  MigratePlan,
  PlannedComponentEdit,
  PlannedReplacement,
  SkippedReplacement,
  TokenSkipReason,
  UsageRef,
} from "./plan.js";
export { planMigration } from "./plan.js";
export type { ApplyFileResult, ApplyResult } from "./apply.js";
export { applyMigration } from "./apply.js";
export type { RevertResult } from "./revert.js";
export { revertMigration } from "./revert.js";
export { planExcludes, projectStyles, residualByCategory, usageKey } from "./project.js";
export type { AuditNumbers } from "./report.js";
export { formatPlanSummary, pct, renderMigrateReport } from "./report.js";
