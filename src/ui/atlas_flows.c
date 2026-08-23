/*
 * atlas_flows.c — CBM Atlas flows: named entry→terminal call journeys.
 *
 * A flow is what a human reads to learn how the codebase RUNS: pick an
 * entry point, follow CALLS with bounded depth and branching, stop at
 * sinks. Deterministic (ties break by id), honest about truncation
 * (dropped candidates and capped steps are counted, never silent), and
 * cached per (project, indexed_at) like the region level.
 *
 * Entry scoring (deterministic, from stored data only):
 *   +4  is_entry_point / url_path (route handler) property
 *   +2  no callers but real callees (a root of the call DAG)
 *   +1  entry-ish name (main, run*, handle*, serve*, cmd*, on[A-Z]…, *_main)
 *   ratio bonus: callees outweigh callers
 */
#include "foundation/constants.h"
#include "ui/atlas.h"
#include "foundation/hash_table.h"

#include <sqlite3.h>
#include <yyjson/yyjson.h>

#include <ctype.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
    FLOW_MAX_CANDIDATES = 200, /* scored entries considered */
    FLOW_MAX_FLOWS = 60,       /* flows kept after dedup + rank */
    FLOW_MAX_DEPTH = 6,        /* call depth per flow */
    FLOW_MAX_CHILDREN = 4,     /* callees followed per step */
    FLOW_MAX_STEPS = 40,       /* steps per flow */
    FLOW_MIN_STEPS = 3,        /* smaller journeys teach nothing */
    FLOW_NODE_CAP = 500000,    /* callable-graph size bound for the cache */
};

/* ── In-memory call graph (cache) ─────────────────────────────── */

typedef struct {
    int64_t id;
    char *name;
    char *file_path;
    int32_t first_out; /* index into out_edges, -1 none */
    int32_t out_count;
    int32_t in_count;
    uint8_t flagged_entry; /* is_entry_point or route property */
} flow_node_t;

typedef struct {
    int32_t steps[FLOW_MAX_STEPS]; /* node indices, DFS order */
    int32_t parent[FLOW_MAX_STEPS];
    uint8_t depth[FLOW_MAX_STEPS];
    int step_count;
    int32_t entry;
    int32_t terminal; /* deepest sink (or deepest step) */
    bool sink_terminated;
    bool cross_region;
    int steps_capped;
} flow_t;

typedef struct {
    char key[1152];
    flow_node_t *nodes;
    int node_count;
    int32_t *out_edges; /* callee node indices, grouped by caller */
    flow_t *flows;
    int flow_count;
    int candidates_dropped;
    long long callable_total;
} flow_cache_t;

static flow_cache_t g_flow_cache;
static pthread_mutex_t g_flow_mu = PTHREAD_MUTEX_INITIALIZER;

static char *fl_strdup(const char *s) {
    if (!s)
        return NULL;
    size_t len = strlen(s) + 1;
    char *copy = malloc(len);
    if (copy)
        memcpy(copy, s, len);
    return copy;
}

static void flow_cache_clear_locked(void) {
    for (int i = 0; i < g_flow_cache.node_count; i++) {
        free(g_flow_cache.nodes[i].name);
        free(g_flow_cache.nodes[i].file_path);
    }
    free(g_flow_cache.nodes);
    free(g_flow_cache.out_edges);
    free(g_flow_cache.flows);
    memset(&g_flow_cache, 0, sizeof(g_flow_cache));
}

void cbm_atlas_flows_cache_clear(void) {
    pthread_mutex_lock(&g_flow_mu);
    flow_cache_clear_locked();
    pthread_mutex_unlock(&g_flow_mu);
}

static void flow_cache_key(cbm_store_t *store, const char *project, char *out, size_t cap) {
    char stamp[128] = {0};
    struct sqlite3 *db = cbm_store_get_db(store);
    sqlite3_stmt *st = NULL;
    if (db && sqlite3_prepare_v2(db, "SELECT indexed_at FROM projects WHERE name=?1", -1, &st,
                                 NULL) == SQLITE_OK) {
        sqlite3_bind_text(st, 1, project, -1, SQLITE_STATIC);
        if (sqlite3_step(st) == SQLITE_ROW) {
            const char *t = (const char *)sqlite3_column_text(st, 0);
            if (t)
                snprintf(stamp, sizeof(stamp), "%s", t);
        }
        sqlite3_finalize(st);
    }
    snprintf(out, cap, "%s|%s", project, stamp);
}

/* ── Entry scoring ────────────────────────────────────────────── */

static bool fl_entryish_name(const char *name) {
    if (!name || !name[0])
        return false;
    if (strcmp(name, "main") == 0 || strcmp(name, "run") == 0)
        return true;
    static const char *const prefixes[] = {"handle", "run_", "serve", "cmd_", "do_", "start"};
    for (size_t i = 0; i < sizeof(prefixes) / sizeof(prefixes[0]); i++)
        if (strncmp(name, prefixes[i], strlen(prefixes[i])) == 0)
            return true;
    if (name[0] == 'o' && name[1] == 'n' && isupper((unsigned char)name[2]))
        return true;
    size_t len = strlen(name);
    if (len > 5 && strcmp(name + len - 5, "_main") == 0)
        return true;
    return false;
}

static int fl_score(const flow_node_t *node) {
    /* Tests are journeys into the code, not of it: a test function is never
     * an interesting entry unless the indexer flagged it as a real one. */
    if (!node->flagged_entry && node->file_path && cbm_is_test_file_path(node->file_path))
        return 0;
    int score = 0;
    if (node->flagged_entry)
        score += 4;
    if (node->in_count == 0 && node->out_count > 0)
        score += 2;
    if (fl_entryish_name(node->name))
        score += 1;
    if (node->out_count > node->in_count)
        score += 1;
    return score;
}

typedef struct {
    int32_t node;
    int score;
} fl_candidate_t;

static int fl_candidate_cmp(const void *a, const void *b) {
    const fl_candidate_t *ca = a, *cb = b;
    if (cb->score != ca->score)
        return cb->score - ca->score;
    return ca->node - cb->node; /* deterministic tie-break */
}

/* Rank comparator: sink-terminated first, then longer, then entry order. */
static int fl_flow_cmp(const void *a, const void *b) {
    const flow_t *fa = a, *fb = b;
    if (fa->sink_terminated != fb->sink_terminated)
        return fb->sink_terminated - fa->sink_terminated;
    if (fb->step_count != fa->step_count)
        return fb->step_count - fa->step_count;
    return fa->entry - fb->entry;
}

/* ── Build ────────────────────────────────────────────────────── */

typedef struct {
    int64_t id;
    int32_t idx;
} fl_id_idx_t;

static int fl_id_idx_cmp(const void *a, const void *b) {
    int64_t ia = ((const fl_id_idx_t *)a)->id, ib = ((const fl_id_idx_t *)b)->id;
    return (ia > ib) - (ia < ib);
}

static int32_t fl_index_of(const fl_id_idx_t *map, int n, int64_t id) {
    int lo = 0, hi = n - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (map[mid].id == id)
            return map[mid].idx;
        if (map[mid].id < id)
            lo = mid + 1;
        else
            hi = mid - 1;
    }
    return -1;
}

/* DFS from `entry`, children capped and ordered by (desc out_count, id):
 * the busiest callee first reads as the "trunk" of the journey. */
static void fl_walk(const flow_cache_t *cache, flow_t *flow, int32_t entry) {
    memset(flow, 0, sizeof(*flow));
    flow->entry = entry;
    flow->terminal = entry;
    bool *visited = calloc((size_t)cache->node_count, sizeof(bool));
    if (!visited)
        return;

    typedef struct {
        int32_t node;
        int32_t parent_step;
        uint8_t depth;
    } frame_t;
    frame_t stack[FLOW_MAX_STEPS * FLOW_MAX_CHILDREN];
    int sp = 0;
    stack[sp++] = (frame_t){entry, -1, 0};
    int deepest = -1;
    while (sp > 0 && flow->step_count < FLOW_MAX_STEPS) {
        frame_t frame = stack[--sp];
        if (visited[frame.node])
            continue;
        visited[frame.node] = true;
        int step = flow->step_count;
        flow->steps[step] = frame.node;
        flow->parent[step] = frame.parent_step;
        flow->depth[step] = frame.depth;
        flow->step_count++;
        const flow_node_t *node = &cache->nodes[frame.node];
        if (frame.depth > deepest ||
            (frame.depth == deepest && node->out_count == 0 && !flow->sink_terminated)) {
            deepest = frame.depth;
            flow->terminal = frame.node;
            flow->sink_terminated = node->out_count == 0;
        }
        if (frame.depth >= FLOW_MAX_DEPTH)
            continue;
        /* Collect up to FLOW_MAX_CHILDREN unvisited callees, best last so
         * the busiest pops first (LIFO). */
        int32_t picked[FLOW_MAX_CHILDREN];
        int npicked = 0;
        for (int e = 0; e < node->out_count; e++) {
            int32_t callee = cache->out_edges[node->first_out + e];
            if (visited[callee])
                continue;
            /* Insertion into a small best-of list by (out_count desc, id). */
            int pos = npicked;
            while (pos > 0) {
                const flow_node_t *have = &cache->nodes[picked[pos - 1]];
                const flow_node_t *cand = &cache->nodes[callee];
                if (have->out_count > cand->out_count ||
                    (have->out_count == cand->out_count && picked[pos - 1] < callee))
                    break;
                pos--;
            }
            if (npicked < FLOW_MAX_CHILDREN) {
                for (int m = npicked; m > pos; m--)
                    picked[m] = picked[m - 1];
                picked[pos] = callee;
                npicked++;
            } else if (pos < FLOW_MAX_CHILDREN) {
                for (int m = FLOW_MAX_CHILDREN - 1; m > pos; m--)
                    picked[m] = picked[m - 1];
                picked[pos] = callee;
                flow->steps_capped++;
            } else {
                flow->steps_capped++;
            }
        }
        /* Push worst-first so the best is on top of the stack. */
        for (int m = npicked - 1; m >= 0; m--) {
            if (sp < (int)(sizeof(stack) / sizeof(stack[0])))
                stack[sp++] = (frame_t){picked[m], step, (uint8_t)(frame.depth + 1)};
        }
    }
    free(visited);
}

static int fl_rebuild_locked(cbm_store_t *store, const char *project, const char *key) {
    flow_cache_clear_locked();
    struct sqlite3 *db = cbm_store_get_db(store);
    if (!db)
        return -1;

    /* 1. Callable nodes with entry flags. */
    sqlite3_stmt *st = NULL;
    const char *nsql =
        "SELECT id, name, file_path, "
        "COALESCE(json_extract(properties,'$.is_entry_point'),0), "
        "CASE WHEN json_extract(properties,'$.url_path') IS NOT NULL THEN 1 ELSE 0 END "
        "FROM nodes WHERE project=?1 AND label IN (" CBM_SQL_CALLABLE_LABELS ") "
        "ORDER BY id LIMIT ?2";
    if (sqlite3_prepare_v2(db, nsql, -1, &st, NULL) != SQLITE_OK)
        return -1;
    sqlite3_bind_text(st, 1, project, -1, SQLITE_STATIC);
    sqlite3_bind_int(st, 2, FLOW_NODE_CAP + 1);
    int cap = 0, n = 0;
    flow_node_t *nodes = NULL;
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (n >= cap) {
            int nc = cap ? cap * 2 : 4096;
            flow_node_t *grown = realloc(nodes, (size_t)nc * sizeof(flow_node_t));
            if (!grown)
                break;
            nodes = grown;
            cap = nc;
        }
        memset(&nodes[n], 0, sizeof(flow_node_t));
        nodes[n].id = sqlite3_column_int64(st, 0);
        nodes[n].name = fl_strdup((const char *)sqlite3_column_text(st, 1));
        nodes[n].file_path = fl_strdup((const char *)sqlite3_column_text(st, 2));
        nodes[n].first_out = -1;
        nodes[n].flagged_entry =
            sqlite3_column_int(st, 3) != 0 || sqlite3_column_int(st, 4) != 0;
        n++;
    }
    sqlite3_finalize(st);
    if (n == 0 || n > FLOW_NODE_CAP) {
        /* Empty graph, or beyond the honest bound — no flows rather than
         * silently partial ones. */
        g_flow_cache.nodes = nodes;
        g_flow_cache.node_count = n > FLOW_NODE_CAP ? 0 : n;
        g_flow_cache.callable_total = n;
        if (n > FLOW_NODE_CAP) {
            for (int i = 0; i < n; i++) {
                free(nodes[i].name);
                free(nodes[i].file_path);
            }
            free(nodes);
            g_flow_cache.nodes = NULL;
        }
        snprintf(g_flow_cache.key, sizeof(g_flow_cache.key), "%s", key);
        return 0;
    }

    fl_id_idx_t *idmap = malloc((size_t)n * sizeof(fl_id_idx_t));
    if (!idmap) {
        g_flow_cache.nodes = nodes;
        g_flow_cache.node_count = n;
        flow_cache_clear_locked();
        return -1;
    }
    for (int i = 0; i < n; i++)
        idmap[i] = (fl_id_idx_t){nodes[i].id, i};
    qsort(idmap, (size_t)n, sizeof(fl_id_idx_t), fl_id_idx_cmp);

    /* 2. CALLS edges → CSR adjacency (two passes over one query result
     * would need materialization; count first via GROUP BY, then fill). */
    int32_t *src = NULL, *dst = NULL;
    int ecap = 0, ne = 0;
    if (sqlite3_prepare_v2(db,
                           "SELECT source_id, target_id FROM edges WHERE project=?1 AND "
                           "type='CALLS'",
                           -1, &st, NULL) == SQLITE_OK) {
        sqlite3_bind_text(st, 1, project, -1, SQLITE_STATIC);
        while (sqlite3_step(st) == SQLITE_ROW) {
            int32_t si = fl_index_of(idmap, n, sqlite3_column_int64(st, 0));
            int32_t di = fl_index_of(idmap, n, sqlite3_column_int64(st, 1));
            if (si < 0 || di < 0 || si == di)
                continue;
            if (ne >= ecap) {
                int nc = ecap ? ecap * 2 : 8192;
                int32_t *ns = realloc(src, (size_t)nc * sizeof(int32_t));
                int32_t *nd = realloc(dst, (size_t)nc * sizeof(int32_t));
                if (!ns || !nd) {
                    free(ns ? ns : src);
                    free(nd ? nd : dst);
                    src = dst = NULL;
                    ne = 0;
                    break;
                }
                src = ns;
                dst = nd;
                ecap = nc;
            }
            src[ne] = si;
            dst[ne] = di;
            ne++;
        }
        sqlite3_finalize(st);
    }
    free(idmap);

    for (int e = 0; e < ne; e++) {
        nodes[src[e]].out_count++;
        nodes[dst[e]].in_count++;
    }
    int32_t *out_edges = malloc(ne > 0 ? (size_t)ne * sizeof(int32_t) : sizeof(int32_t));
    int32_t *cursor = calloc((size_t)n, sizeof(int32_t));
    if (out_edges && cursor) {
        int32_t offset = 0;
        for (int i = 0; i < n; i++) {
            nodes[i].first_out = offset;
            offset += nodes[i].out_count;
        }
        for (int e = 0; e < ne; e++)
            out_edges[nodes[src[e]].first_out + cursor[src[e]]++] = dst[e];
    }
    free(cursor);
    free(src);
    free(dst);
    if (!out_edges) {
        for (int i = 0; i < n; i++) {
            free(nodes[i].name);
            free(nodes[i].file_path);
        }
        free(nodes);
        return -1;
    }

    g_flow_cache.nodes = nodes;
    g_flow_cache.node_count = n;
    g_flow_cache.out_edges = out_edges;
    g_flow_cache.callable_total = n;

    /* 3. Score candidates, walk flows, dedup by (entry, terminal). */
    fl_candidate_t *cands = malloc((size_t)n * sizeof(fl_candidate_t));
    if (!cands)
        return -1;
    int ncand = 0;
    for (int i = 0; i < n; i++) {
        int score = fl_score(&nodes[i]);
        if (score > 0 && nodes[i].out_count > 0)
            cands[ncand++] = (fl_candidate_t){i, score};
    }
    qsort(cands, (size_t)ncand, sizeof(fl_candidate_t), fl_candidate_cmp);
    int considered = ncand < FLOW_MAX_CANDIDATES ? ncand : FLOW_MAX_CANDIDATES;
    g_flow_cache.candidates_dropped = ncand - considered;

    flow_t *flows = malloc(sizeof(flow_t) * FLOW_MAX_FLOWS * 2);
    CBMHashTable *seen_pair = cbm_ht_create(256);
    char **pair_keys = calloc(FLOW_MAX_FLOWS * 2, sizeof(char *));
    int nflows = 0;
    if (flows && seen_pair && pair_keys) {
        for (int c = 0; c < considered && nflows < FLOW_MAX_FLOWS * 2; c++) {
            flow_t flow;
            fl_walk(&g_flow_cache, &flow, cands[c].node);
            if (flow.step_count < FLOW_MIN_STEPS)
                continue;
            char pair[64];
            snprintf(pair, sizeof(pair), "%lld>%lld", (long long)nodes[flow.entry].id,
                     (long long)nodes[flow.terminal].id);
            if (cbm_ht_has(seen_pair, pair))
                continue;
            pair_keys[nflows] = fl_strdup(pair);
            if (pair_keys[nflows])
                cbm_ht_set(seen_pair, pair_keys[nflows], (void *)(intptr_t)1);
            /* Cross-region when any two steps live in different regions. */
            int first_region = -1;
            flow.cross_region = false;
            for (int s2 = 0; s2 < flow.step_count && !flow.cross_region; s2++) {
                const char *fp = nodes[flow.steps[s2]].file_path;
                if (!fp)
                    continue;
                int region = cbm_layout_region_for_file(store, project, fp, NULL);
                if (region < 0)
                    continue;
                if (first_region < 0)
                    first_region = region;
                else if (region != first_region)
                    flow.cross_region = true;
            }
            flows[nflows++] = flow;
        }
    }
    for (int i = 0; i < FLOW_MAX_FLOWS * 2; i++)
        free(pair_keys ? pair_keys[i] : NULL);
    free(pair_keys);
    cbm_ht_free(seen_pair);
    free(cands);
    if (!flows)
        return -1;
    qsort(flows, (size_t)nflows, sizeof(flow_t), fl_flow_cmp);
    if (nflows > FLOW_MAX_FLOWS)
        nflows = FLOW_MAX_FLOWS;
    g_flow_cache.flows = flows;
    g_flow_cache.flow_count = nflows;
    snprintf(g_flow_cache.key, sizeof(g_flow_cache.key), "%s", key);
    return 0;
}

static bool fl_cache_fresh_locked(const char *key) {
    return g_flow_cache.key[0] && strcmp(g_flow_cache.key, key) == 0;
}

static int fl_ensure_locked(cbm_store_t *store, const char *project) {
    char key[1152];
    flow_cache_key(store, project, key, sizeof(key));
    if (fl_cache_fresh_locked(key))
        return 0;
    return fl_rebuild_locked(store, project, key);
}

/* ── JSON ─────────────────────────────────────────────────────── */

static void fl_add_node_ref(yyjson_mut_doc *doc, yyjson_mut_val *obj, const char *field,
                            const flow_node_t *node) {
    yyjson_mut_val *ref = yyjson_mut_obj(doc);
    yyjson_mut_obj_add_int(doc, ref, "id", node->id);
    yyjson_mut_obj_add_strcpy(doc, ref, "name", node->name ? node->name : "?");
    if (node->file_path)
        yyjson_mut_obj_add_strcpy(doc, ref, "file_path", node->file_path);
    yyjson_mut_obj_add_val(doc, obj, field, ref);
}

char *cbm_atlas_flows_json(cbm_store_t *store, const char *project) {
    if (!store || !project)
        return NULL;
    pthread_mutex_lock(&g_flow_mu);
    if (fl_ensure_locked(store, project) != 0) {
        pthread_mutex_unlock(&g_flow_mu);
        return NULL;
    }
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_val *root = yyjson_mut_obj(doc);
    yyjson_mut_doc_set_root(doc, root);
    yyjson_mut_obj_add_int(doc, root, "callable_total", g_flow_cache.callable_total);
    yyjson_mut_obj_add_int(doc, root, "candidates_dropped", g_flow_cache.candidates_dropped);
    yyjson_mut_val *arr = yyjson_mut_arr(doc);
    for (int i = 0; i < g_flow_cache.flow_count; i++) {
        const flow_t *flow = &g_flow_cache.flows[i];
        yyjson_mut_val *obj = yyjson_mut_obj(doc);
        yyjson_mut_obj_add_int(doc, obj, "id", i);
        char label[CBM_SZ_512];
        snprintf(label, sizeof(label), "%s → %s",
                 g_flow_cache.nodes[flow->entry].name ? g_flow_cache.nodes[flow->entry].name
                                                      : "?",
                 g_flow_cache.nodes[flow->terminal].name
                     ? g_flow_cache.nodes[flow->terminal].name
                     : "?");
        yyjson_mut_obj_add_strcpy(doc, obj, "label", label);
        fl_add_node_ref(doc, obj, "entry", &g_flow_cache.nodes[flow->entry]);
        fl_add_node_ref(doc, obj, "terminal", &g_flow_cache.nodes[flow->terminal]);
        yyjson_mut_obj_add_int(doc, obj, "steps", flow->step_count);
        yyjson_mut_obj_add_bool(doc, obj, "sink_terminated", flow->sink_terminated);
        yyjson_mut_obj_add_bool(doc, obj, "cross_region", flow->cross_region);
        if (flow->steps_capped > 0)
            yyjson_mut_obj_add_int(doc, obj, "steps_capped", flow->steps_capped);
        yyjson_mut_arr_append(arr, obj);
    }
    yyjson_mut_obj_add_val(doc, root, "flows", arr);
    pthread_mutex_unlock(&g_flow_mu);
    char *json = yyjson_mut_write(doc, 0, NULL);
    yyjson_mut_doc_free(doc);
    return json;
}

char *cbm_atlas_flow_json(cbm_store_t *store, const char *project, int flow_id) {
    if (!store || !project || flow_id < 0)
        return NULL;
    pthread_mutex_lock(&g_flow_mu);
    if (fl_ensure_locked(store, project) != 0 || flow_id >= g_flow_cache.flow_count) {
        pthread_mutex_unlock(&g_flow_mu);
        return NULL;
    }
    const flow_t *flow = &g_flow_cache.flows[flow_id];
    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_val *root = yyjson_mut_obj(doc);
    yyjson_mut_doc_set_root(doc, root);
    yyjson_mut_obj_add_int(doc, root, "id", flow_id);
    fl_add_node_ref(doc, root, "entry", &g_flow_cache.nodes[flow->entry]);
    fl_add_node_ref(doc, root, "terminal", &g_flow_cache.nodes[flow->terminal]);
    yyjson_mut_obj_add_bool(doc, root, "sink_terminated", flow->sink_terminated);
    yyjson_mut_obj_add_bool(doc, root, "cross_region", flow->cross_region);
    if (flow->steps_capped > 0)
        yyjson_mut_obj_add_int(doc, root, "steps_capped", flow->steps_capped);
    yyjson_mut_val *steps = yyjson_mut_arr(doc);
    for (int s = 0; s < flow->step_count; s++) {
        const flow_node_t *node = &g_flow_cache.nodes[flow->steps[s]];
        yyjson_mut_val *obj = yyjson_mut_obj(doc);
        yyjson_mut_obj_add_int(doc, obj, "id", node->id);
        yyjson_mut_obj_add_strcpy(doc, obj, "name", node->name ? node->name : "?");
        if (node->file_path)
            yyjson_mut_obj_add_strcpy(doc, obj, "file_path", node->file_path);
        yyjson_mut_obj_add_int(doc, obj, "depth", flow->depth[s]);
        yyjson_mut_obj_add_int(doc, obj, "parent", flow->parent[s]);
        yyjson_mut_arr_append(steps, obj);
    }
    yyjson_mut_obj_add_val(doc, root, "steps", steps);
    pthread_mutex_unlock(&g_flow_mu);
    char *json = yyjson_mut_write(doc, 0, NULL);
    yyjson_mut_doc_free(doc);
    return json;
}
