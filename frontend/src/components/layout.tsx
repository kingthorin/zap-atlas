import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const MenuIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
);
const XIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
);
const MapIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
);
const FileIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
);
const DatabaseIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.022.547M6 5a2 2 0 012-2h8a2 2 0 012 2v2.586a1 1 0 00.293.707l2.143 2.143c.04.04.075.086.105.124l.508.508a1 1 0 00.293.293l.508.508c.038.038.084.065.124.105l2.143 2.143a1 1 0 00.707.293V19a2 2 0 01-2 2H6a2 2 0 01-2-2V5zM9 14a2 2 0 00-2-2H5a2 2 0 00-2 2v1a2 2 0 002 2h2a2 2 0 002-2zm0 0l2-2m-2 2l2 2m-2-2H7.2a2 2 0 00-1.134.894L4.226 16.8a2 2 0 00-.338.937V19a2 2 0 002 2h10a2 2 0 002-2v-1.2a2 2 0 00-.338-.937l-1.268-.634a2 2 0 00-1.134-.894H11a2 2 0 00-2-2z" /></svg>
);
const ActivityIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
);
const BookIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
);
const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
);

export const NAV = [
  { to: "/", label: "Overview", icon: MapIcon },
  { to: "/repositories", label: "Repositories", icon: FileIcon },
  { to: "/architecture", label: "Architecture", icon: DatabaseIcon },
  { to: "/history", label: "History", icon: ActivityIcon },
  { to: "/source", label: "Source", icon: FileIcon },
  { to: "/stories", label: "Stories", icon: BookIcon },
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
          <Link to="/" className="flex items-center gap-2 font-nav font-bold text-xl tracking-tight text-zap-dark" aria-label="ZAP Atlas home">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width={38} height={38} />
            <span>ZAP <span className="text-zap-orange-dark">Atlas</span></span>
          </Link>
          <button className="md:hidden p-2 text-zap-dark" onClick={() => setOpen(!open)} aria-label="Toggle menu" aria-expanded={open}>
            {open ? <XIcon /> : <MenuIcon />}
          </button>
          <div className="hidden md:flex md:flex-row md:items-center">
            <NavLinks pathname={location.pathname} />
            <ThemeButton />
          </div>
        </div>
        {open && (
          <div className="md:hidden flex flex-col px-4 pb-3" onClick={() => setOpen(false)}>
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
          <Link key={n.to} to={n.to} className="site-nav-link" aria-current={active ? "page" : undefined}>
            <Icon /> {n.label}
          </Link>
        );
      })}
    </>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zap-lightest text-slate-900 font-sans">
      <Nav />
      <main className="p-4 md:p-6 max-w-6xl mx-auto">
        {children}
      </main>
    </div>
  );
}
