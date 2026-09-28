"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { IDENTIFIER_LABEL } from "@/lib/format";
import type { Identifier } from "@/lib/session";

const TYPES: Array<{ type: string; placeholder: string; inputType?: string; help?: string }> = [
  { type: "FULL_NAME", placeholder: "First and last name" },
  { type: "ALIAS", placeholder: "Maiden name, nickname…", help: "Hidden by default." },
  { type: "EMAIL", placeholder: "you@example.com", inputType: "email" },
  { type: "PHONE", placeholder: "(555) 555-1234", inputType: "tel" },
  { type: "USERNAME", placeholder: "yourhandle" },
  { type: "LOCATION", placeholder: "City, ST (e.g. Boca Raton, FL)" },
  { type: "DOMAIN", placeholder: "yourdomain.com", help: "Only domains you control." },
  { type: "BUSINESS_NAME", placeholder: "Your public business name" },
  { type: "DATE_OF_BIRTH", placeholder: "YYYY-MM-DD", inputType: "date", help: "Optional. Improves matching accuracy; never sent to search providers." },
];

/** MY IDENTITIES editor: masked display, add, delete, explicit reveal. */
export function IdentifierEditor({ profileId, identifiers, onChange, compact }: { profileId: string; identifiers: Identifier[]; onChange(): void; compact?: boolean }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  async function add(type: string) {
    const value = (drafts[type] ?? "").trim();
    if (!value) return;
    try {
      await api(`/profile/${profileId}/identifiers`, { body: { type, value } });
      setDrafts((d) => ({ ...d, [type]: "" }));
      setErrors((e) => ({ ...e, [type]: "" }));
      onChange();
    } catch (err) {
      setErrors((e) => ({ ...e, [type]: (err as Error).message }));
    }
  }
  async function remove(id: string) {
    await api(`/profile/${profileId}/identifiers/${id}`, { method: "DELETE" });
    onChange();
  }
  async function reveal(id: string) {
    const r = await api<{ value: string }>(`/profile/${profileId}/identifiers/${id}/reveal`, { body: {} });
    setRevealed((v) => ({ ...v, [id]: r.value }));
    setTimeout(() => setRevealed((v) => ({ ...v, [id]: "" })), 15_000);
  }

  return (
    <div className="stack" style={{ gap: compact ? 14 : 20 }}>
      {TYPES.map((t) => {
        const existing = identifiers.filter((i) => i.type === t.type);
        return (
          <div key={t.type}>
            <div className="row between">
              <strong className="small">{IDENTIFIER_LABEL[t.type]}</strong>
              {t.help && <span className="small faint">{t.help}</span>}
            </div>
            <div className="stack" style={{ gap: 6, margin: "6px 0" }}>
              {existing.map((i) => (
                <div key={i.id} className="row" style={{ gap: 8 }}>
                  <span className="mono small" style={{ minWidth: 180 }}>{revealed[i.id] || i.displayValue}</span>
                  {i.masked && !revealed[i.id] && (
                    <button className="btn ghost sm" type="button" onClick={() => void reveal(i.id)}>Reveal</button>
                  )}
                  <button className="btn ghost sm" type="button" onClick={() => void remove(i.id)} aria-label={`Delete ${IDENTIFIER_LABEL[t.type]}`}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
              <input
                className="input"
                type={t.inputType ?? "text"}
                placeholder={t.placeholder}
                value={drafts[t.type] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [t.type]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void add(t.type))}
                aria-label={`Add ${IDENTIFIER_LABEL[t.type]}`}
              />
              <button className="btn sm" type="button" onClick={() => void add(t.type)}>Add</button>
            </div>
            {errors[t.type] && <div className="error-text">{errors[t.type]}</div>}
          </div>
        );
      })}
    </div>
  );
}
