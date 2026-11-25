import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SearchGroup, SearchRecord } from "../lib/data";
import { KIND_LABEL, PREFIXES, engine, parseQuery, routeFor } from "../lib/search";

const MAX = 12;

/** A search box over the current page: Cmd or Ctrl + K opens it, arrow keys and Enter pick a result, Escape closes it. */
export default function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchRecord[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const before = useRef<Element | null>(null);                 // where focus was, to put it back on close
  const seq = useRef(0);
  const navigate = useNavigate();
  const { prefix, term } = parseQuery(q);

  useEffect(() => {
    if (open) { before.current = document.activeElement; setQ(""); setHits([]); setActive(0); requestAnimationFrame(() => input.current?.focus()); }
    else if (before.current instanceof HTMLElement) before.current.focus();
  }, [open]);

  useEffect(() => {                                            // Escape works even before focus has reached the box
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  useEffect(() => {
    const run = ++seq.current;
    if (!open || !term.trim()) { setHits([]); setBusy(false); return; }
    const only = prefix ? PREFIXES[prefix] : null;
    const groups: SearchGroup[] = only ? [only.group] : ["ecosystem", "symbols"];      // commits are a large index: ask for them with c:
    setBusy(true);
    (async () => {
      const out: SearchRecord[] = [];
      for (const g of groups) {
        const ms = await engine(g);
        let found = ms.search(term) as unknown as SearchRecord[];
        if (only?.kinds) found = found.filter(h => only.kinds!.includes(h.k));
        out.push(...found.slice(0, MAX));
      }
      if (run === seq.current) { setHits(out.slice(0, MAX)); setActive(0); setBusy(false); }
    })().catch(() => run === seq.current && setBusy(false));
  }, [open, q]);

  if (!open) return null;
  const go = (r: SearchRecord | undefined) => {
    if (!r) return;
    const to = routeFor(r);
    onClose();
    if (to) navigate(to); else if (r.u && /^https:\/\//i.test(r.u)) window.location.href = r.u;
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey || !hits.length) { onClose(); navigate(`/search?q=${encodeURIComponent(q)}`); } else go(hits[active]);
    } else if (e.key === "Tab") e.preventDefault();             // focus stays in the box; the list is driven by the arrow keys
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-[12vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden" onKeyDown={onKey}>
        <input ref={input} autoFocus value={q} onChange={e => setQ(e.target.value)} role="combobox" aria-expanded={hits.length > 0} aria-controls="palette-list"
          aria-activedescendant={hits.length ? `palette-${active}` : undefined} aria-label="Search" autoComplete="off" spellCheck={false}
          placeholder="Search…  (t: types, a: add-ons, c: commits, h: help pages)"
          className="w-full px-4 py-3 text-sm bg-white border-b border-slate-200 outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500" />
        <ul id="palette-list" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto text-sm">
          {hits.map((r, i) => (
            <li key={r.i} id={`palette-${i}`} role="option" aria-selected={i === active}
              ref={el => { if (el && i === active) el.scrollIntoView({ block: "nearest" }); }}
              onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); go(r); }}
              className={`flex gap-3 px-4 py-1.5 cursor-pointer ${i === active ? "bg-indigo-600 text-white" : "text-slate-800"}`}>
              <span className={`w-16 shrink-0 text-xs pt-0.5 ${i === active ? "text-indigo-100" : "text-slate-500"}`}>{KIND_LABEL[r.k] ?? r.k}</span>
              <span className="break-all">{r.t || r.i}</span>
            </li>
          ))}
        </ul>
        <div className="px-4 py-1.5 text-xs text-slate-500 border-t border-slate-200" role="status">
          {busy ? "Searching…" : term.trim() && !hits.length ? "No matches." : !term.trim()
            ? <>Start with <code>t:</code> types, <code>a:</code> add-ons, <code>c:</code> commits, <code>h:</code> help pages, <code>m:</code> modules, <code>s:</code> stories.</>
            : <>↑ ↓ to move, Enter to open, Ctrl or Cmd + Enter for all results, Esc to close.</>}
        </div>
      </div>
    </div>
  );
}
