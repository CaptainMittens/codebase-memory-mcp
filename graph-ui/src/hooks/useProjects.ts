import { useCallback, useEffect, useState } from "react";
import { callTool } from "../api/rpc";
import type { Project, SchemaInfo } from "../lib/types";

interface ProjectInfo {
  project: Project;
  schema: SchemaInfo | null;
}

interface UseProjectsResult {
  projects: ProjectInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Schemas above this size are not fetched: get_graph_schema scans every
   * node and edge, which on a multi-million-node index takes ~30 s. The card
   * still shows totals from list_projects; only the label chips are absent. */
  const SCHEMA_LAZY_MAX_NODES = 1_000_000;

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await callTool<{ projects: Project[] }>("list_projects");
      const list = result.projects ?? [];

      /* Render immediately from list_projects' own totals… */
      setProjects(list.map((p) => ({ project: p, schema: null })));
      setLoading(false);

      /* …then enrich with per-label schemas one at a time, patching each
       * card as its schema lands. Sequential on purpose: N parallel schema
       * scans would serialize behind the store lock anyway. */
      for (const p of list) {
        if ((p.nodes ?? 0) > SCHEMA_LAZY_MAX_NODES) continue;
        try {
          const schema = await callTool<SchemaInfo>("get_graph_schema", {
            project: p.name,
          });
          setProjects((prev) =>
            prev.map((info) =>
              info.project.name === p.name ? { ...info, schema } : info,
            ),
          );
        } catch {
          /* card keeps its totals; chips stay absent */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch projects");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return { projects, loading, error, refresh: fetchProjects };
}
