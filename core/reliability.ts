/**
 * Source reliability (spec §26) and provider health (spec §28).
 * All numbers come from the platform's own history; with too little data we
 * say so instead of showing a number.
 */
export const MIN_RELIABILITY_SAMPLES = 10;

export interface ReliabilityInput {
  completed: number;
  removed: number;
  failed: number;
  reappeared: number;
  avgRemovalDays: number | null;
}

export interface Reliability {
  sampleSize: number;
  sufficientData: boolean;
  successRate: number | null;
  averageRemovalDays: number | null;
  reappearance: "Low" | "Moderate" | "High" | null;
}

export function computeReliability(i: ReliabilityInput): Reliability {
  const n = i.removed + i.failed;
  if (n < MIN_RELIABILITY_SAMPLES) {
    return { sampleSize: n, sufficientData: false, successRate: null, averageRemovalDays: null, reappearance: null };
  }
  const reRate = i.removed ? i.reappeared / i.removed : 0;
  return {
    sampleSize: n,
    sufficientData: true,
    successRate: Math.round((i.removed / n) * 1000) / 1000,
    averageRemovalDays: i.avgRemovalDays == null ? null : Math.round(i.avgRemovalDays * 10) / 10,
    reappearance: reRate < 0.1 ? "Low" : reRate < 0.3 ? "Moderate" : "High",
  };
}

export interface HealthWindow {
  succeeded: number;
  failed: number;
}

export interface HealthDecision {
  failureRate: number;
  samples: number;
  shouldPause: boolean;
}

/** Circuit breaker: pause automation when the recent failure rate crosses the threshold. */
export function evaluateHealth(w: HealthWindow, threshold: number, minSamples: number): HealthDecision {
  const samples = w.succeeded + w.failed;
  const failureRate = samples ? w.failed / samples : 0;
  return { failureRate: Math.round(failureRate * 1000) / 1000, samples, shouldPause: samples >= minSamples && failureRate >= threshold };
}
