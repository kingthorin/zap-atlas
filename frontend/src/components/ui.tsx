import * as React from "react";
import { useEffect, useState } from "react";

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className || ""}`}>
      {children}
    </div>
  );
}
export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-col space-y-1.5 p-6 ${className || ""}`}>{children}</div>;
}
export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`text-xl font-semibold tracking-tight ${className || ""}`}>{children}</h3>;
}
export function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-6 pt-0 ${className || ""}`}>{children}</div>;
}

export function Loading() {
  return <div className="p-4 text-slate-500 italic">Loading…</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="p-4 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
      {message}
    </div>
  );
}

/** Copies a block of Markdown, ready to paste into a GitHub issue or pull request. */
export function CopyForGitHub({ text }: { text: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  useEffect(() => { if (!state) return; const t = setTimeout(() => setState(""), 2500); return () => clearTimeout(t); }, [state]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState("copied"); }
    catch {
      const ta = document.createElement("textarea");           // older browsers and non-secure pages
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
      try { setState(document.execCommand("copy") ? "copied" : "failed"); } catch { setState("failed"); }
      ta.remove();
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={copy} title="Copy a Markdown summary with a link pinned to the analysed commit"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-indigo-300 bg-white text-sm font-semibold text-indigo-700 hover:border-indigo-500 hover:bg-indigo-50">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></svg>
        Copy for GitHub
      </button>
      <span role="status" className="text-xs text-slate-500">{state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : ""}</span>
    </span>
  );
}
