/**
 * Minimal, safe template resolution: `{{a.b.c}}` looks up a dot-path.
 * No expressions, no code execution. Unknown paths resolve to "" and are
 * reported so a step can fail loudly instead of submitting blanks.
 */
export function lookup(scope: unknown, path: string): unknown {
  let cur: unknown = scope;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function render(template: string, scope: unknown, missing: string[] = []): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path: string) => {
    const v = lookup(scope, path);
    if (v === undefined || v === null || v === "") {
      missing.push(path);
      return "";
    }
    return String(v);
  });
}

export function renderRecord(obj: Record<string, unknown> | undefined, scope: unknown, missing: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj ?? {})) out[k] = render(String(v), scope, missing);
  return out;
}
