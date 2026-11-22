import * as React from "react";

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
