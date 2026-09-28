import { z } from "zod";
import { AutomationStatus, DiscoveryMethod, ExposureCategory, RemovalMethod } from "../../shared/domain";

const values = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];

/** A registry entry (spec §5). One JSON file per source in ./sources. */
export const DataSourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,64}$/),
  name: z.string().min(1),
  domain: z.string().min(3),
  categories: z.array(z.enum(values(ExposureCategory))).min(1),
  discoveryMethods: z.array(z.enum(values(DiscoveryMethod))).min(1),
  removalMethods: z.array(z.enum(values(RemovalMethod))).min(1),
  requiresUserVerification: z.boolean(),
  requiresEmailVerification: z.boolean(),
  requiresIdentityVerification: z.boolean(),
  /** Days until removal is typically visible. */
  estimatedRemovalTime: z.number().int().positive(),
  reappearsFrequently: z.boolean(),
  supportedRegions: z.array(z.string()).min(1),
  automationStatus: z.enum(values(AutomationStatus)),
  /** Which removal-agent implementation handles this source. */
  agent: z.string().default("manual-guidance"),
  optOutUrl: z.string().url().optional(),
  privacyContactEmail: z.string().email().optional(),
  parentSourceId: z.string().optional(),
  notes: z.string().optional(),
  /** ISO date an admin last confirmed the opt-out details. */
  lastVerifiedAt: z.string().optional(),
});

export type DataSource = z.infer<typeof DataSourceSchema>;
