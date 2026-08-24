import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { callTool } from "../api/rpc";
import type { Project } from "../lib/types";

/* The project is the context every other view depends on, so it lives
 * first in the header as a switcher — not as a trailing chip gating a row
 * of dead tabs. */
export function ProjectSwitcher({
  selected,
  allProjectsLabel,
  onSelect,
  onAllProjects,
}: {
  selected: string | null;
  allProjectsLabel: string;
  onSelect: (project: string) => void;
  onAllProjects: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    if (projects !== null) return;
    callTool<{ projects: Project[] }>("list_projects", {})
      .then((result) => setProjects(result.projects ?? []))
      .catch(() => setProjects([]));
  }, [projects]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    /* Focus lands in the filter so typing narrows immediately. */
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0);
    const onDocClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node))
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (projects === null) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(needle));
  }, [projects, query]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => {
          setOpen((v) => !v);
          load();
        }}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[13px] transition-all max-w-[280px] ${
          selected
            ? "bg-popover border-border/40 text-foreground/85 hover:border-border"
            : "bg-primary/15 border-primary/40 text-primary hover:bg-primary/25"
        }`}
        title={selected ?? "Choose which indexed project to explore"}
      >
        <span className="font-mono truncate">{selected ?? "Select a project…"}</span>
        <span className="text-foreground/40 text-[11px] shrink-0">▾</span>
      </button>
      {open && (
        <>
          {/* Backdrop: dims the page so the panel reads as a layer, and
           * makes click-away obvious. Portaled to <body> — the header's
           * backdrop-filter makes it the containing block for fixed
           * children, which would clamp the overlay to the header bar. */}
          {createPortal(
            <div
              className="fixed inset-0 bg-black/50 z-20"
              onMouseDown={() => setOpen(false)}
            />,
            document.body,
          )}
          <div className="absolute top-full left-0 mt-1.5 w-[340px] bg-surface-3 border border-border rounded-md shadow-2xl shadow-black/60 z-30 overflow-hidden">
            <div className="p-2 border-b border-border/60">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && filtered && filtered.length > 0) {
                    setOpen(false);
                    onSelect(filtered[0].name);
                  }
                }}
                placeholder="Search projects…"
                className="w-full bg-background border border-border/60 rounded-md px-2.5 py-1.5 text-[13px] text-foreground placeholder-foreground/35 outline-none focus:border-primary/60 transition-all"
              />
            </div>
            <div className="py-1 max-h-[50vh] overflow-y-auto">
              {filtered === null && (
                <p className="px-3 py-2 text-[13px] text-foreground/40">Loading…</p>
              )}
              {filtered !== null && filtered.length === 0 && (
                <p className="px-3 py-2 text-[13px] text-foreground/40">
                  {query ? `Nothing matches "${query}".` : "No indexed projects yet."}
                </p>
              )}
              {(filtered ?? []).map((project) => (
                <button
                  key={project.name}
                  onClick={() => {
                    setOpen(false);
                    onSelect(project.name);
                  }}
                  className={`flex items-center gap-2 w-full text-left px-3 py-1.5 transition-colors hover:bg-surface-4 ${
                    project.name === selected ? "text-primary" : "text-foreground/75"
                  }`}
                >
                  <span className="text-[13px] font-mono truncate">{project.name}</span>
                  {project.name === selected && (
                    <span className="ml-auto text-[11px] shrink-0">●</span>
                  )}
                </button>
              ))}
            </div>
            <div className="border-t border-border/60 py-1 bg-surface-3">
              <button
                onClick={() => {
                  setOpen(false);
                  onAllProjects();
                }}
                className="w-full text-left px-3 py-1.5 text-[13px] text-foreground/55 hover:text-foreground/85 hover:bg-surface-4 transition-colors"
              >
                {allProjectsLabel} — manage &amp; index →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
