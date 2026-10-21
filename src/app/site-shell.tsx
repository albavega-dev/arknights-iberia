"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Anchor, ChevronsLeft, ChevronsRight, DraftingCompass } from "lucide-react";

const destinations = [
  { href: "/", label: "Inicio" },
  { href: "/operators", label: "Operadores" },
  { href: "/credits", label: "Atribuciones" },
] as const;

export function SiteShell({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const handleHomeClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== "/") {
      return;
    }

    event.preventDefault();
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  return (
    <div className={`app-shell${expanded ? "" : " sidebar-collapsed"}`}>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <aside className="sidebar" aria-label="Navegación de Arknights Iberia">
        <div className="sidebar-top">
          <Link className="brand" href="/" aria-label="Arknights Iberia, inicio" onClick={handleHomeClick}>
            <span className="brand-mark" aria-hidden="true">
              <Anchor strokeWidth={1.7} />
            </span>
            <span className="brand-text">
              ARKNIGHTS
              <br />
              <strong>IBERIA</strong>
            </span>
          </Link>
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={expanded ? "Contraer barra lateral" : "Expandir barra lateral"}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronsLeft aria-hidden="true" strokeWidth={1.75} />
            ) : (
              <ChevronsRight aria-hidden="true" strokeWidth={1.75} />
            )}
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="Secciones principales">
          {destinations.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              title={label}
              onClick={href === "/" ? handleHomeClick : undefined}
              aria-current={
                (href === "/" && pathname === "/") ||
                (href === "/operators" && (pathname === "/operators" || pathname.startsWith("/operators/"))) ||
                (href === "/credits" && (pathname === "/credits" || pathname.startsWith("/credits/")))
                  ? "page"
                  : undefined
              }
            >
              {href === "/" ? (
                <span className="nav-glyph nav-lighthouse-icon" aria-hidden="true" />
              ) : href === "/operators" ? (
                <span className="nav-glyph nav-operators-icon" aria-hidden="true" />
              ) : (
                <span className="nav-glyph" aria-hidden="true">
                  <DraftingCompass size={20} strokeWidth={1.75} />
                </span>
              )}
              <span className="nav-label">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-bottom-text">BETA</span>
        </div>
      </aside>

      <div className="app-content">
        <header className="mobile-header">
          <Link className="mobile-brand" href="/" onClick={handleHomeClick}>
            ARKNIGHTS <span>/ IBERIA</span>
          </Link>
          <button
            type="button"
            className="mobile-menu-button"
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileOpen((value) => !value)}
          >
            {mobileOpen ? "Cerrar" : "Menú"}
          </button>
        </header>
        <nav
          className="mobile-nav"
          id="mobile-navigation"
          aria-label="Secciones principales"
          hidden={!mobileOpen}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMobileOpen(false);
          }}
        >
          {destinations.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                (href === "/" && pathname === "/") ||
                (href === "/operators" && (pathname === "/operators" || pathname.startsWith("/operators/"))) ||
                (href === "/credits" && (pathname === "/credits" || pathname.startsWith("/credits/")))
                  ? "page"
                  : undefined
              }
              onClick={(event) => {
                if (href === "/") handleHomeClick(event);
                setMobileOpen(false);
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
