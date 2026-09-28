import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { AppContext } from "../context";
import { getOwnedProfile } from "../services/profiles";
import { requireUser } from "./app";

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data ?? {});
}

/** Resolve the profile a request targets (?profileId=…), enforcing ownership. */
export async function profileFor(ctx: AppContext, req: FastifyRequest) {
  const user = requireUser(req);
  const q = req.query as { profileId?: string };
  const pid = q.profileId && /^[0-9a-f-]{36}$/i.test(q.profileId) ? q.profileId : undefined;
  return { user, profile: await getOwnedProfile(ctx, user.id, pid) };
}

export function idParam(req: FastifyRequest, name = "id"): string {
  const v = (req.params as Record<string, string>)[name] ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw Object.assign(new Error("Invalid id"), { statusCode: 400 });
  return v;
}

export function sendFile(reply: FastifyReply, type: string, filename: string, body: string | Buffer) {
  reply.header("content-type", type);
  reply.header("content-disposition", `attachment; filename="${filename}"`);
  return reply.send(body);
}
