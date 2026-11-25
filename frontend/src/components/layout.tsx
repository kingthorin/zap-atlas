import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const MenuIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
);
const XIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
);
const MapIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
);
const FilesIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7h-3a2 2 0 01-2-2V2" /><path d="M9 18a2 2 0 01-2-2V4a2 2 0 012-2h7l4 4v10a2 2 0 01-2 2z" /><path d="M3 7.6v12.8A1.6 1.6 0 004.6 22h9.8" /></svg>
);
const HistoryIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></svg>
);
const BookIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>
);
const TagIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M3 12V5a2 2 0 012-2h7l9 9a2 2 0 010 2.83l-6.17 6.17a2 2 0 01-2.83 0L3 12z" /></svg>
);
const CylinderIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" /></svg>
);
const TimelineIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h10M3 12h18M3 18h14" /><circle cx="17" cy="6" r="2" /><circle cx="7" cy="18" r="0.5" /></svg>
);
const GraphIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8 7l8 1M7 8l4 8M17 10l-4 6" /></svg>
);
const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
);

const ExpandIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" /></svg>
);
const ShrinkIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h7M14 12h7M7 8l4 4-4 4M17 8l-4 4 4 4" /></svg>
);

export const NAV = [
  { to: "/", label: "Overview", icon: MapIcon },
  { to: "/timeline", label: "Timeline", icon: TimelineIcon },
  { to: "/graph", label: "Graph", icon: GraphIcon },
  { to: "/releases", label: "Releases", icon: TagIcon },
  { to: "/stories", label: "Stories", icon: BookIcon },
  { to: "/repositories", label: "Repositories", icon: CylinderIcon },
  { to: "/history", label: "History", icon: HistoryIcon },
  { to: "/source", label: "Source", icon: FilesIcon },
  { to: "/search", label: "Search", icon: SearchIcon },
];

type Theme = "light" | "dark" | "system";
const THEMES: Theme[] = ["system", "light", "dark"];
const THEME_LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("atlas-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch { return "system"; }
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  const cycle = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem("atlas-theme", next); } catch { /* ignore */ }
    setTheme(next);
  };
  return [theme, cycle];
}

function ThemeButton() {
  const [theme, cycle] = useTheme();
  return (
    <button onClick={cycle} className="site-nav-link" aria-label={`Theme: ${THEME_LABEL[theme]} (click to change)`} title="Change theme">
      Theme: {THEME_LABEL[theme]}
    </button>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  return (
    <header className="site-header">
      <nav aria-label="Main navigation">
        <div className="flex items-center justify-between px-4 py-2">
          <Link to="/" className="flex items-center gap-2 whitespace-nowrap font-nav font-bold text-xl tracking-tight text-zap-dark" aria-label="ZAP Atlas home">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width={38} height={38} />
            <span>ZAP <span className="text-zap-orange-dark">Atlas</span></span>
          </Link>
          <button className="xl:hidden p-2 text-zap-dark" onClick={() => setOpen(!open)} aria-label="Toggle menu" aria-expanded={open}>
            {open ? <XIcon /> : <MenuIcon />}
          </button>
          <div className="hidden xl:flex xl:flex-row xl:items-center">
            <NavLinks pathname={location.pathname} />
            <ThemeButton />
          </div>
        </div>
        {open && (
          <div className="xl:hidden flex flex-col px-4 pb-3" onClick={() => setOpen(false)}>
            <NavLinks pathname={location.pathname} />
            <ThemeButton />
          </div>
        )}
      </nav>
    </header>
  );
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <>
      {NAV.map(n => {
        const Icon: any = n.icon;
        const active = pathname === n.to;
        return (
          <Link key={n.to} to={n.to} className="site-nav-link" title={n.to === "/search" ? "Search (Ctrl or Cmd + K)" : undefined} aria-current={active ? "page" : undefined}>
            <Icon /> {n.label}
          </Link>
        );
      })}
    </>
  );
}

// Pages with wide content can use the whole window; the choice is offered only on screens 1352 px and wider (the standard width leaves at least 150 px unused from there).
const WIDE_PAGES = ["/graph", "/timeline", "/source", "/releases", "/history"];

function useWide(): [boolean, () => void] {
  const [wide, setWide] = useState(() => { try { return localStorage.getItem("atlas-wide") === "1"; } catch { return false; } });
  const toggle = () => setWide(w => { try { localStorage.setItem("atlas-wide", w ? "0" : "1"); } catch { /* ignore */ } return !w; });
  return [wide, toggle];
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [wide, toggleWide] = useWide();
  const navigate = useNavigate();
  // Cmd or Ctrl + K goes to Search, or focuses the box when already there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      const box = document.querySelector<HTMLInputElement>("[data-search-input]");
      if (box) { box.focus(); box.select(); } else navigate("/search");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
  const canWiden = WIDE_PAGES.includes(useLocation().pathname);
  return (
    <div className="min-h-screen bg-zap-lightest text-slate-900 font-sans">
      <Nav />
      <main className={`p-4 md:p-6 max-w-6xl mx-auto ${wide && canWiden ? "min-[1352px]:max-w-none" : ""}`}>
        {canWiden && (
          <div className="hidden min-[1352px]:flex justify-end -mt-2 mb-2">
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-indigo-300 bg-white text-sm font-semibold text-indigo-700 hover:border-indigo-500 hover:bg-indigo-50"
              aria-pressed={wide} onClick={toggleWide}>
              {wide ? <ShrinkIcon /> : <ExpandIcon />}
              {wide ? "Standard width" : "Full width"}
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
