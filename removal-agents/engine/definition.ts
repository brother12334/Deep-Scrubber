import { z } from "zod";
import { WorkflowStepType } from "../../shared/domain";

const stepTypes = Object.values(WorkflowStepType) as [WorkflowStepType, ...WorkflowStepType[]];

/**
 * Structured, versioned removal workflow (spec §7). Stored in
 * provider_configs.definition; bundled defaults live in
 * providers/registry/workflows/<source>.v<N>.json.
 *
 * Templates (`{{...}}`) are resolved at run time against:
 *   base, sourceDomain, subject.*, record.url, context.*, secure.*
 */
export const WorkflowStepSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,48}$/),
  type: z.enum(stepTypes),
  /** Dot-path into the run context; the step is skipped when falsy. */
  when: z.string().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const WorkflowDefinitionSchema = z
  .object({
    source: z.string(),
    version: z.number().int().positive(),
    description: z.string().optional(),
    steps: z.array(WorkflowStepSchema).min(1).max(40),
  })
  .superRefine((def, ctx) => {
    const ids = new Set<string>();
    for (const s of def.steps) {
      if (ids.has(s.id)) ctx.addIssue({ code: "custom", message: `Duplicate step id ${s.id}` });
      ids.add(s.id);
    }
    if (!def.steps.some((s) => s.type === "SUBMIT" || s.type === "SEND_EMAIL")) {
      ctx.addIssue({ code: "custom", message: "A workflow must contain a SUBMIT or SEND_EMAIL step" });
    }
  });

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

/** Step types that have side effects on a third party and must never be blindly retried. */
export const NON_IDEMPOTENT_STEPS: ReadonlySet<string> = new Set(["SUBMIT", "SEND_EMAIL"]);
