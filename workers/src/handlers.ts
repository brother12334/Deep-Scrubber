import type { AppContext } from "../../backend/src/context";
import { JobNames, type JobName, type JobPayloads } from "../../backend/src/infra/queue";
import { evaluateProviderHealth } from "../../backend/src/services/health";
import { monitoringTick, runMonitoringJob } from "../../backend/src/services/monitoring";
import { dispatchNotification } from "../../backend/src/services/notifications";
import { executeRequest } from "../../backend/src/services/removals";
import { retentionSweep } from "../../backend/src/services/retention";
import { runScan } from "../../backend/src/services/scans";
import { verifyRecord } from "../../backend/src/services/verification";

/**
 * Job dispatch table (spec §19). Handlers are idempotent: every job re-reads
 * current state from PostgreSQL and uses conditional updates to claim work,
 * so retries and duplicate deliveries are safe.
 */
export function createJobHandler(ctx: AppContext) {
  return async function handle(name: JobName, data: unknown): Promise<void> {
    switch (name) {
      case JobNames.Discovery:
        return runScan(ctx, (data as JobPayloads["DiscoveryJob"]).scanId);
      case JobNames.Removal:
        await executeRequest(ctx, (data as JobPayloads["RemovalJob"]).requestId);
        return;
      case JobNames.Verification:
      case JobNames.Search:
        await verifyRecord(ctx, data as JobPayloads["VerificationJob"]);
        return;
      case JobNames.Monitoring:
        return runMonitoringJob(ctx, (data as JobPayloads["MonitoringJob"]).monitoringJobId);
      case JobNames.Notification:
        return dispatchNotification(ctx, (data as JobPayloads["NotificationJob"]).notificationId);
      case JobNames.MonitoringTick:
      case JobNames.WorkflowResumeTick:
        await monitoringTick(ctx);
        return;
      case JobNames.RetentionSweep:
        await retentionSweep(ctx);
        return;
      case JobNames.ProviderHealth:
        await evaluateProviderHealth(ctx);
        return;
      default:
        throw new Error(`Unknown job ${String(name)}`);
    }
  };
}
