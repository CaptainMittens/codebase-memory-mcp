import { useEffect, useState } from "react";
import {
  fetchWhy,
  formatGuard,
  allUnguarded,
  type WhyEntry,
  type WhyPayload,
} from "../lib/why";

/* The Why view: "when does this run?" — callers on the spine, each edge
 * carrying its syntactic guard chain as chips, expandable upward in place.
 * Thin by default; elision declared; guards honest about being syntactic. */

function GuardChips({ entry }: { entry: WhyEntry }) {
  if (entry.guards_unavailable)
    return <span className="text-[12px] text-foreground/35">guards unavailable (source not readable)</span>;
  if (entry.guards.length === 0 && !entry.loop)
    return <span className="text-[12px] text-foreground/35">unguarded — always on this path</span>;
  return (
    <span className="inline-flex flex-wrap gap-1 items-center">
      {entry.loop && (
        <span className="text-[11px] px-1.5 rounded-full border border-border/60 text-foreground/50" title="the call site sits inside a loop">
          ⟳ loop
        </span>
      )}
      {entry.guards.map((guard, index) => (
        <span
          key={index}
          className={`text-[11px] px-1.5 rounded-full border font-mono ${
            guard.negated
              ? "border-warn/50 text-warn/90 bg-warn/10"
              : "border-primary/40 text-primary/90 bg-primary/10"
          }`}
          title={`syntactic ${guard.kind} guard around the call site — not a proven path condition`}
        >
          ? {formatGuard(guard)}
        </span>
      ))}
    </span>
  );
}

function WhyLevel({
  project,
  refId,
  direction,
  depth,
  onOpenSymbol,
}: {
  project: string;
  refId: number;
  direction: "up" | "down";
  depth: number;
  onOpenSymbol: (ref: { id?: number; qn?: string }) => void;
}) {
  const [payload, setPayload] = useState<WhyPayload | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setExpanded(new Set());
    fetchWhy(project, { id: refId }, direction)
      .then((p) => {
        if (!cancelled) setPayload(p);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [project, refId, direction]);

  if (error)
    return <p className="text-[12px] text-foreground/35">could not load this level</p>;
  if (!payload)
    return <p className="text-[12px] text-foreground/35">tracing…</p>;
  if (payload.entries.length === 0)
    return (
      <p className="text-[13px] text-foreground/40">
        {direction === "up"
          ? "No resolved callers — an entry point, or reached another way (dispatch, event, reflection)."
          : "No resolved callees."}
      </p>
    );

  return (
    <div className={depth > 0 ? "border-l border-border/40 pl-3 ml-1" : ""}>
      {payload.entries.map((entry) => (
        <div key={entry.id} className="py-[3px]">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-foreground/35 text-[12px] shrink-0">
              {direction === "up" ? "←" : "→"}
            </span>
            <button
              onClick={() => onOpenSymbol({ id: entry.id })}
              className="text-[13px] font-mono text-foreground/75 hover:text-primary transition-colors"
              title={entry.file_path && entry.line ? `${entry.file_path}:${entry.line}` : entry.file_path}
            >
              {entry.name}
            </button>
            <GuardChips entry={entry} />
            {direction === "up" && entry.more > 0 && (
              <button
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(entry.id)) next.delete(entry.id);
                    else next.add(entry.id);
                    return next;
                  })
                }
                className="text-[12px] text-foreground/40 hover:text-primary transition-colors"
              >
                {expanded.has(entry.id)
                  ? "− collapse"
                  : `⌄ ${entry.more} caller${entry.more === 1 ? "" : "s"} above`}
              </button>
            )}
          </div>
          {expanded.has(entry.id) && depth < 6 && (
            <WhyLevel
              project={project}
              refId={entry.id}
              direction={direction}
              depth={depth + 1}
              onOpenSymbol={onOpenSymbol}
            />
          )}
        </div>
      ))}
      {payload.total > payload.entries.length && (
        <p className="text-[12px] text-foreground/35 mt-1">
          {payload.entries.length} of {payload.total} shown — the rest via the caller list
          above.
        </p>
      )}
    </div>
  );
}

export function TriggerTree({
  project,
  symbolId,
  onOpenSymbol,
}: {
  project: string;
  symbolId: number;
  onOpenSymbol: (ref: { id?: number; qn?: string }) => void;
}) {
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [root, setRoot] = useState<WhyPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRoot(null);
    fetchWhy(project, { id: symbolId }, direction)
      .then((p) => {
        if (!cancelled) setRoot(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project, symbolId, direction]);

  return (
    <div className="bg-card border border-border/50 rounded-md p-4">
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-[12px] uppercase tracking-widest text-foreground/40">
          {direction === "up" ? "When does this run?" : "What does this trigger?"}
        </p>
        <button
          onClick={() => setDirection((d) => (d === "up" ? "down" : "up"))}
          className="ml-auto text-[12px] text-foreground/45 hover:text-primary transition-colors"
        >
          {direction === "up" ? "→ what it triggers" : "← when it runs"}
        </button>
      </div>
      {root && allUnguarded(root.entries) && root.entries.length > 0 && root.entries.length <= 2 ? (
        <p className="text-[13px] text-foreground/60">
          {direction === "up" ? "Always runs when " : "Always triggers "}
          {root.entries.map((entry, index) => (
            <span key={entry.id}>
              {index > 0 && " and "}
              <button
                onClick={() => onOpenSymbol({ id: entry.id })}
                className="font-mono text-foreground/80 hover:text-primary transition-colors"
              >
                {entry.name}
              </button>
            </span>
          ))}
          {direction === "up" ? " runs — no conditions at the call sites." : " — unconditionally."}
        </p>
      ) : (
        <WhyLevel
          project={project}
          refId={symbolId}
          direction={direction}
          depth={0}
          onOpenSymbol={onOpenSymbol}
        />
      )}
      <p className="text-[11px] text-foreground/30 mt-2">
        Guards are the syntactic conditions around each call site — not proven path
        conditions. Dispatch, events and reflection are invisible here.
      </p>
    </div>
  );
}
