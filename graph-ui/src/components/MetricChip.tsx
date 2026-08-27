/* The wiki affordance: any metric name in the UI becomes a dotted-underline
 * chip that opens the metric wiki panel — the label itself is the door to
 * the definition. Inherits the surrounding typography so wrapping an
 * existing label changes nothing but the underline. */
import { type ReactNode } from "react";
import { wikiEntry } from "../wiki/entries";

export function MetricChip({
  slug,
  onOpen,
  children,
}: {
  slug: string;
  onOpen: (slug: string) => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(slug)}
      className="[font:inherit] [letter-spacing:inherit] text-inherit align-baseline text-left border-b border-dotted border-foreground/40 hover:border-primary hover:text-primary transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-none"
      title="What does this mean? Open the metric wiki"
    >
      {children ?? wikiEntry(slug)?.term ?? slug}
    </button>
  );
}
