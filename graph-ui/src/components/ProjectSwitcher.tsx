import { useCallback, useEffect, useRef, useState } from "react";
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
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    if (projects !== null) return;
    callTool<{ projects: Project[] }>("list_projects", {})
      .then((result) => setProjects(result.projects ?? []))
      .catch(() => setProjects([]));
  }, [projects]);

  useEffect(() => {
    if (!open) return;
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
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
        <div className="absolute top-full left-0 mt-1 w-[320px] bg-popover border border-border/60 rounded-md shadow-xl z-30 py-1 max-h-[60vh] overflow-y-auto">
          {projects === null && (
            <p className="px-3 py-2 text-[13px] text-foreground/40">Loading…</p>
          )}
          {projects !== null && projects.length === 0 && (
            <p className="px-3 py-2 text-[13px] text-foreground/40">
              No indexed projects yet.
            </p>
          )}
          {(projects ?? []).map((project) => (
            <button
              key={project.name}
              onClick={() => {
                setOpen(false);
                onSelect(project.name);
              }}
              className={`flex items-center gap-2 w-full text-left px-3 py-1.5 transition-colors hover:bg-surface-3 ${
                project.name === selected ? "text-primary" : "text-foreground/70"
              }`}
            >
              <span className="text-[13px] font-mono truncate">{project.name}</span>
              {project.name === selected && (
                <span className="ml-auto text-[11px] shrink-0">●</span>
              )}
            </button>
          ))}
          <div className="border-t border-border/40 mt-1 pt-1">
            <button
              onClick={() => {
                setOpen(false);
                onAllProjects();
              }}
              className="w-full text-left px-3 py-1.5 text-[13px] text-foreground/55 hover:text-foreground/85 hover:bg-surface-3 transition-colors"
            >
              {allProjectsLabel} — manage &amp; index →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
