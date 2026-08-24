/*
 * atlas.h — CBM Atlas data services beyond the layout itself.
 *
 * Pure JSON producers over an open store; the HTTP handlers in
 * http_server.c stay thin (open store → call → reply) and tests call these
 * directly on in-memory stores.
 */
#ifndef CBM_UI_ATLAS_H
#define CBM_UI_ATLAS_H

#include "store/store.h"

#include <stdint.h>

/* ── Modules tree (GET /api/tree) ─────────────────────────────────
 * Aggregated children of one folder: sub-folders with file/symbol counts,
 * files directly inside it, per-child dominant region and missed-coverage
 * counts. `path` is a repo-relative folder ("" or "." = root). */
char *cbm_atlas_tree_json(cbm_store_t *store, const char *project, const char *path);

/* ── Symbol bundle (GET /api/symbol) ──────────────────────────────
 * Everything the symbol page needs in one response: the node (with
 * docstring and flags), its region, callers and callees with TRUE totals,
 * per-edge-type counts and pagination, tests, co-change partners and
 * near-clones. Lookup by id, or by qualified name when id < 0. */
char *cbm_atlas_symbol_json(cbm_store_t *store, const char *project, int64_t node_id,
                            const char *qualified_name, int limit, int offset);

/* ── Flows (GET /api/flows, /api/flow) ────────────────────────────
 * Named entry→terminal call flows: entry candidates scored from stored
 * flags + call shape, bounded DFS over CALLS, deduplicated and ranked.
 * Computed lazily and cached per (project, indexed_at). */
char *cbm_atlas_flows_json(cbm_store_t *store, const char *project);
char *cbm_atlas_flow_json(cbm_store_t *store, const char *project, int flow_id);

/* Drop the flows cache (tests). */
void cbm_atlas_flows_cache_clear(void);

/* ── Dashboard metrics (GET /api/metrics) ─────────────────────────
 * Graph-derived metrics with drill-down lists: complexity/length
 * histograms and tops (from pass_complexity's stored numbers), edge
 * certainty, dead code, tests/duplication/missed counts, per-file churn
 * from a bounded `git log` (zero indexing cost), churn×complexity, and a
 * per-index history sidecar for trends. Cached per (project, indexed_at). */
char *cbm_atlas_metrics_json(cbm_store_t *store, const char *project);
void cbm_atlas_metrics_cache_clear(void);

/* ── File history & ownership (atlas_metrics.c) ───────────────────
 * The rationale proxy: recent commits and authorship of one file, from the
 * same bounded git-log pass the dashboard churn uses (cached together).
 * Returns {"available":false} JSON when the project has no git history. */
char *cbm_atlas_file_history_json(cbm_store_t *store, const char *project, const char *file_path);

/* ── A→B trace (atlas_flows.c) ────────────────────────────────────
 * Reachability between two callables over CALLS ("calls") or DATA_FLOWS
 * ("data"): shortest path within a bounded depth, honest about the bound.
 * Endpoints resolve by node id (>=0) or qualified name. */
char *cbm_atlas_trace_json(cbm_store_t *store, const char *project, int64_t from_id,
                           const char *from_qn, int64_t to_id, const char *to_qn, const char *mode);

/* ── Region lookups (layout_regions.c) ────────────────────────────
 * Cache-backed; computing on first use. name_out (optional) receives a
 * heap copy the caller frees. Returns region id or -1. */
int cbm_layout_region_for_file(cbm_store_t *store, const char *project, const char *file_path,
                               char **name_out);

#endif /* CBM_UI_ATLAS_H */
