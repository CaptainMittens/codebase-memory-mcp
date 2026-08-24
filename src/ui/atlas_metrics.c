/*
 * atlas_metrics.c — the CBM Atlas Dashboard: graph-derived metrics with
 * drill-down, computed from data the index already stores plus one bounded
 * `git log` pass — ZERO cost added to indexing time.
 *
 * Tier 0 (stored): cyclomatic + cognitive complexity, lines and flags per
 * callable (pass_complexity), edge certainty (CALLS vs CALL_REFERENCE vs
 * USAGE), dead code, TESTS linkage, SIMILAR_TO duplication, missed files.
 * Tier 1 (computed here, cached): per-file churn from `git log` (same
 * bounds as pass_githistory: 1 year, ≤10k commits), churn × complexity.
 * History: one snapshot per indexed_at appended to a sidecar JSONL in the
 * cache dir, so the dashboard can show trends across reindexes.
 */
#include "foundation/constants.h"
#include "ui/atlas.h"
#include "foundation/compat_fs.h"
#include "foundation/hash_table.h"
#include "foundation/str_util.h"
#include "foundation/workspace.h"

#include <sqlite3.h>
#include <yyjson/yyjson.h>

#include <math.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
    MX_TOP_N = 10,        /* entries per drill-down list */
    MX_HISTORY_MAX = 60,  /* snapshots served to the dashboard */
    MX_CHURN_MIN_CPLX = 10, /* churn×complexity: only genuinely complex files */
};

/* Complexity histogram bucket upper bounds (inclusive); last is open. */
static const int MX_CPLX_BUCKETS[] = {1, 5, 10, 20, 50};
static const int MX_LINE_BUCKETS[] = {10, 30, 60, 120};

typedef struct {
    char *qn;
    char *name;
    char *file;
    long long value;
    long long value2; /* secondary detail (e.g. raw commits behind a score) */
} mx_entry_t;

typedef struct {
    mx_entry_t items[MX_TOP_N];
    int count;
} mx_top_t;

/* Keep the MX_TOP_N largest values (stable for ties: first seen wins). */
static void mx_top_offer2(mx_top_t *top, const char *qn, const char *name, const char *file,
                          long long value, long long value2) {
    int pos = top->count < MX_TOP_N ? top->count : MX_TOP_N;
    while (pos > 0 && top->items[pos - 1].value < value)
        pos--;
    if (pos >= MX_TOP_N)
        return;
    mx_entry_t incoming;
    incoming.qn = qn ? strdup(qn) : NULL;
    incoming.name = name ? strdup(name) : NULL;
    incoming.file = file ? strdup(file) : NULL;
    incoming.value = value;
    incoming.value2 = value2;
    mx_entry_t last = {0};
    if (top->count == MX_TOP_N) {
        last = top->items[MX_TOP_N - 1];
    } else {
        top->count++;
    }
    for (int i = top->count - 1; i > pos; i--)
        top->items[i] = top->items[i - 1];
    top->items[pos] = incoming;
    free(last.qn);
    free(last.name);
    free(last.file);
}

static void mx_top_offer(mx_top_t *top, const char *qn, const char *name, const char *file,
                         long long value) {
    mx_top_offer2(top, qn, name, file, value, 0);
}

static void mx_top_free(mx_top_t *top) {
    for (int i = 0; i < top->count; i++) {
        free(top->items[i].qn);
        free(top->items[i].name);
        free(top->items[i].file);
    }
    top->count = 0;
}

static void mx_top_json(yyjson_mut_doc *doc, yyjson_mut_val *root, const char *field,
                        const mx_top_t *top) {
    yyjson_mut_val *arr = yyjson_mut_arr(doc);
    for (int i = 0; i < top->count; i++) {
        yyjson_mut_val *obj = yyjson_mut_obj(doc);
        if (top->items[i].qn)
            yyjson_mut_obj_add_strcpy(doc, obj, "qn", top->items[i].qn);
        if (top->items[i].name)
            yyjson_mut_obj_add_strcpy(doc, obj, "name", top->items[i].name);
        if (top->items[i].file)
            yyjson_mut_obj_add_strcpy(doc, obj, "file", top->items[i].file);
        yyjson_mut_obj_add_int(doc, obj, "value", top->items[i].value);
        if (top->items[i].value2 > 0)
            yyjson_mut_obj_add_int(doc, obj, "commits", top->items[i].value2);
        yyjson_mut_arr_append(arr, obj);
    }
    yyjson_mut_obj_add_val(doc, root, field, arr);
}

/* ── Cache ────────────────────────────────────────────────────── */

typedef struct {
    char key[1152];
    char *json;
} mx_cache_t;

static mx_cache_t g_mx_cache;
static pthread_mutex_t g_mx_mu = PTHREAD_MUTEX_INITIALIZER;

void cbm_atlas_metrics_cache_clear(void) {
    pthread_mutex_lock(&g_mx_mu);
    free(g_mx_cache.json);
    memset(&g_mx_cache, 0, sizeof(g_mx_cache));
    pthread_mutex_unlock(&g_mx_mu);
}

static void mx_project_stamp(cbm_store_t *store, const char *project, char *stamp, size_t cap,
                             char *root_path, size_t root_cap) {
    stamp[0] = '\0';
    if (root_path)
        root_path[0] = '\0';
    struct sqlite3 *db = cbm_store_get_db(store);
    sqlite3_stmt *st = NULL;
    if (db && sqlite3_prepare_v2(db, "SELECT indexed_at, root_path FROM projects WHERE name=?1",
                                 -1, &st, NULL) == SQLITE_OK) {
        sqlite3_bind_text(st, 1, project, -1, SQLITE_STATIC);
        if (sqlite3_step(st) == SQLITE_ROW) {
            const char *t = (const char *)sqlite3_column_text(st, 0);
            const char *r = (const char *)sqlite3_column_text(st, 1);
            if (t)
                snprintf(stamp, cap, "%s", t);
            if (r && root_path)
                snprintf(root_path, root_cap, "%s", r);
        }
        sqlite3_finalize(st);
    }
}

/* ── Churn: one bounded `git log` pass, cached with everything else ── */

typedef struct {
    CBMHashTable *counts; /* file_path → (intptr_t)count; keys owned by list */
    char **keys;
    int key_count;
    int key_cap;
} mx_churn_t;

static void mx_churn_scan(const char *root_path, mx_churn_t *churn) {
    if (!root_path || !root_path[0] || !cbm_validate_shell_path_arg(root_path))
        return;
    churn->counts = cbm_ht_create(1024);
    if (!churn->counts)
        return;
#ifdef _WIN32
    const char *null_dev = "NUL";
#else
    const char *null_dev = "/dev/null";
#endif
    char cmd[CBM_SZ_2K];
    snprintf(cmd, sizeof(cmd),
             "git -C \"%s\" log --name-only --pretty=format: --since=\"1 year ago\" "
             "--max-count=10000 2>%s",
             root_path, null_dev);
    FILE *fp = cbm_popen(cmd, "r");
    if (!fp)
        return;
    char line[CBM_SZ_1K];
    while (fgets(line, sizeof(line), fp)) {
        size_t len = strlen(line);
        while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r'))
            line[--len] = '\0';
        if (len == 0)
            continue;
        const char *canon = cbm_ht_get_key(churn->counts, line);
        if (!canon) {
            if (churn->key_count >= churn->key_cap) {
                int nc = churn->key_cap ? churn->key_cap * 2 : 1024;
                char **grown = realloc(churn->keys, (size_t)nc * sizeof(char *));
                if (!grown)
                    break;
                churn->keys = grown;
                churn->key_cap = nc;
            }
            churn->keys[churn->key_count] = strdup(line);
            if (!churn->keys[churn->key_count])
                break;
            canon = churn->keys[churn->key_count];
            churn->key_count++;
        }
        intptr_t count = (intptr_t)cbm_ht_get(churn->counts, canon);
        cbm_ht_set(churn->counts, canon, (void *)(count + 1));
    }
    cbm_pclose(fp);
}

static void mx_churn_free(mx_churn_t *churn) {
    cbm_ht_free(churn->counts);
    for (int i = 0; i < churn->key_count; i++)
        free(churn->keys[i]);
    free(churn->keys);
    memset(churn, 0, sizeof(*churn));
}

/* ── History sidecar (JSONL, one snapshot per indexed_at) ─────── */

static void mx_history_path(const char *project, char *out, size_t cap) {
    const char *cache = cbm_workspace_cache_dir();
    snprintf(out, cap, "%s/atlas-metrics-%s.jsonl", cache ? cache : ".", project);
}

static void mx_history_append_and_emit(yyjson_mut_doc *doc, yyjson_mut_val *root,
                                       const char *project, const char *stamp,
                                       long long callables, long long dead, double avg_cplx,
                                       long long tested, long long usage_edges,
                                       long long callish_edges) {
    if (!cbm_validate_project_name(project))
        return;
    char path[CBM_SZ_1K];
    mx_history_path(project, path, sizeof(path));

    /* Read existing lines (bounded). */
    char *lines[MX_HISTORY_MAX];
    int line_count = 0;
    bool stamp_present = false;
    FILE *fp = cbm_fopen(path, "r");
    if (fp) {
        char buf[CBM_SZ_2K];
        while (fgets(buf, sizeof(buf), fp)) {
            if (strstr(buf, stamp))
                stamp_present = true;
            if (line_count == MX_HISTORY_MAX) {
                free(lines[0]);
                memmove(lines, lines + 1, (size_t)(MX_HISTORY_MAX - 1) * sizeof(char *));
                line_count--;
            }
            lines[line_count] = strdup(buf);
            if (!lines[line_count])
                break;
            line_count++;
        }
        fclose(fp);
    }

    /* Append this index generation once. */
    if (!stamp_present && stamp[0]) {
        FILE *out = cbm_fopen(path, "a");
        if (out) {
            fprintf(out,
                    "{\"indexed_at\":\"%s\",\"callables\":%lld,\"dead\":%lld,"
                    "\"avg_complexity\":%.2f,\"tested\":%lld,\"usage_share\":%.4f}\n",
                    stamp, callables, dead, avg_cplx, tested,
                    callish_edges > 0 ? (double)usage_edges / (double)callish_edges : 0.0);
            fclose(out);
        }
    }

    yyjson_mut_val *history = yyjson_mut_arr(doc);
    for (int i = 0; i < line_count; i++) {
        yyjson_doc *entry = yyjson_read(lines[i], strlen(lines[i]), 0);
        if (entry) {
            yyjson_mut_val *copy = yyjson_val_mut_copy(doc, yyjson_doc_get_root(entry));
            if (copy)
                yyjson_mut_arr_append(history, copy);
            yyjson_doc_free(entry);
        }
        free(lines[i]);
    }
    yyjson_mut_obj_add_val(doc, root, "history", history);
}

/* ── Build ────────────────────────────────────────────────────── */

static char *mx_build_json(cbm_store_t *store, const char *project, const char *stamp,
                           const char *root_path) {
    struct sqlite3 *db = cbm_store_get_db(store);
    if (!db)
        return NULL;

    yyjson_mut_doc *doc = yyjson_mut_doc_new(NULL);
    yyjson_mut_val *root = yyjson_mut_obj(doc);
    yyjson_mut_doc_set_root(doc, root);
    yyjson_mut_obj_add_strcpy(doc, root, "generated_from", stamp);

    /* A. Callable scan: histograms, docstring coverage, top lists, per-file
     * max complexity for the churn join. */
    long long callables = 0, cplx_sum = 0, documented_exported = 0, exported = 0;
    long long cplx_hist[6] = {0};
    long long line_hist[5] = {0};
    mx_top_t top_complex = {0}, top_cognitive = {0}, top_long = {0};
    CBMHashTable *file_cplx = cbm_ht_create(1024); /* file → max complexity */
    char **file_keys = NULL;
    int file_key_count = 0, file_key_cap = 0;

    sqlite3_stmt *st = NULL;
    const char *scan_sql =
        "SELECT name, qualified_name, file_path, "
        "COALESCE(json_extract(properties,'$.complexity'),0), "
        "COALESCE(json_extract(properties,'$.cognitive'),0), "
        "COALESCE(json_extract(properties,'$.lines'),0), "
        "CASE WHEN json_extract(properties,'$.docstring') IS NOT NULL THEN 1 ELSE 0 END, "
        "COALESCE(json_extract(properties,'$.is_exported'),0) "
        "FROM nodes WHERE project=?1 AND label IN (" CBM_SQL_CALLABLE_LABELS ")";
    if (sqlite3_prepare_v2(db, scan_sql, -1, &st, NULL) == SQLITE_OK) {
        sqlite3_bind_text(st, 1, project, -1, SQLITE_STATIC);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *name = (const char *)sqlite3_column_text(st, 0);
            const char *qn = (const char *)sqlite3_column_text(st, 1);
            const char *file = (const char *)sqlite3_column_text(st, 2);
            long long cplx = sqlite3_column_int64(st, 3);
            long long cognitive = sqlite3_column_int64(st, 4);
            long long lines = sqlite3_column_int64(st, 5);
            bool documented = sqlite3_column_int(st, 6) != 0;
            bool is_exported = sqlite3_column_int(st, 7) != 0;
            callables++;
            cplx_sum += cplx;
            int bucket = 0;
            while (bucket < 5 && cplx > MX_CPLX_BUCKETS[bucket])
                bucket++;
            cplx_hist[bucket]++;
            bucket = 0;
            while (bucket < 4 && lines > MX_LINE_BUCKETS[bucket])
                bucket++;
            line_hist[bucket]++;
            if (is_exported) {
                exported++;
                if (documented)
                    documented_exported++;
            }
            if (cplx > 1)
                mx_top_offer(&top_complex, qn, name, file, cplx);
            if (cognitive > 1)
                mx_top_offer(&top_cognitive, qn, name, file, cognitive);
            if (lines > 1)
                mx_top_offer(&top_long, qn, name, file, lines);
            if (file && file[0] && file_cplx) {
                const char *canon = cbm_ht_get_key(file_cplx, file);
                if (!canon) {
                    if (file_key_count >= file_key_cap) {
                        int nc = file_key_cap ? file_key_cap * 2 : 1024;
                        char **grown = realloc(file_keys, (size_t)nc * sizeof(char *));
                        if (grown) {
                            file_keys = grown;
                            file_key_cap = nc;
                        }
                    }
                    if (file_key_count < file_key_cap) {
                        file_keys[file_key_count] = strdup(file);
                        if (file_keys[file_key_count]) {
                            canon = file_keys[file_key_count];
                            file_key_count++;
                        }
                    }
                }
                if (canon) {
                    intptr_t prev = (intptr_t)cbm_ht_get(file_cplx, canon);
                    if (cplx > prev)
                        cbm_ht_set(file_cplx, canon, (void *)(intptr_t)cplx);
                }
            }
        }
        sqlite3_finalize(st);
    }

    /* A2. Distinct indexed files (denominator of the cost sentence). */
    long long total_files = 0;
    if (sqlite3_prepare_v2(db,
                           "SELECT COUNT(DISTINCT file_path) FROM nodes WHERE project=?1 AND "
                           "file_path IS NOT NULL AND file_path != ''",
                           -1, &st, NULL) == SQLITE_OK) {
        sqlite3_bind_text(st, 1, project, -1, SQLITE_STATIC);
        if (sqlite3_step(st) == SQLITE_ROW)
            total_files = sqlite3_column_int64(st, 0);
        sqlite3_finalize(st);
    }

    /* B. Edge certainty. */
    long long calls_edges = 0, ref_edges = 0, usage_edges = 0;
    if (sqlite3_prepare_v2(db,
                           "SELECT type, COUNT(*) FROM edges WHERE project=?1 AND type IN "
                           "('CALLS','CALL_REFERENCE','USAGE') GROUP BY type",
                           -1, &st, NULL) == SQLITE_OK) {
        sqlite3_bind_text(st, 1, project, -1, SQLITE_STATIC);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *type = (const char *)sqlite3_column_text(st, 0);
            long long count = sqlite3_column_int64(st, 1);
            if (type && strcmp(type, "CALLS") == 0)
                calls_edges = count;
            else if (type && strcmp(type, "CALL_REFERENCE") == 0)
                ref_edges = count;
            else if (type)
                usage_edges = count;
        }
        sqlite3_finalize(st);
    }

    /* C. Dead code (candidates only; entry/test/exported excluded, matching
     * the galaxy's classifier). */
    long long dead = 0;
    if (sqlite3_prepare_v2(
            db,
            "SELECT COUNT(*) FROM nodes n WHERE n.project=?1 AND n.label IN "
            "(" CBM_SQL_CALLABLE_LABELS ") AND "
            "COALESCE(json_extract(n.properties,'$.is_entry_point'),0)=0 AND "
            "COALESCE(json_extract(n.properties,'$.is_test'),0)=0 AND "
            "COALESCE(json_extract(n.properties,'$.is_exported'),0)=0 AND "
            "NOT EXISTS (SELECT 1 FROM edges e WHERE e.project=n.project AND "
            "e.target_id=n.id AND e.type IN ('CALLS','CALL_REFERENCE','USAGE'))",
            -1, &st, NULL) == SQLITE_OK) {
        sqlite3_bind_text(st, 1, project, -1, SQLITE_STATIC);
        if (sqlite3_step(st) == SQLITE_ROW)
            dead = sqlite3_column_int64(st, 0);
        sqlite3_finalize(st);
    }

    /* D. Tests + duplication. */
    long long tested = 0, similar_edges = 0;
    if (sqlite3_prepare_v2(db,
                           "SELECT COUNT(DISTINCT target_id) FROM edges WHERE project=?1 AND "
                           "type='TESTS'",
                           -1, &st, NULL) == SQLITE_OK) {
        sqlite3_bind_text(st, 1, project, -1, SQLITE_STATIC);
        if (sqlite3_step(st) == SQLITE_ROW)
            tested = sqlite3_column_int64(st, 0);
        sqlite3_finalize(st);
    }
    if (sqlite3_prepare_v2(db,
                           "SELECT COUNT(*) FROM edges WHERE project=?1 AND type='SIMILAR_TO'",
                           -1, &st, NULL) == SQLITE_OK) {
        sqlite3_bind_text(st, 1, project, -1, SQLITE_STATIC);
        if (sqlite3_step(st) == SQLITE_ROW)
            similar_edges = sqlite3_column_int64(st, 0);
        sqlite3_finalize(st);
    }

    /* E. Missed files (coverage shadow project, #963). */
    long long missed_files = 0;
    {
        char shadow[CBM_SZ_512];
        cbm_store_coverage_shadow_project(shadow, sizeof(shadow), project);
        if (sqlite3_prepare_v2(db,
                               "SELECT COUNT(*) FROM nodes WHERE project=?1 AND label='File'",
                               -1, &st, NULL) == SQLITE_OK) {
            sqlite3_bind_text(st, 1, shadow, -1, SQLITE_STATIC);
            if (sqlite3_step(st) == SQLITE_ROW)
                missed_files = sqlite3_column_int64(st, 0);
            sqlite3_finalize(st);
        }
    }

    /* F. Churn (git, bounded) + churn × complexity. */
    mx_churn_t churn = {0};
    mx_churn_scan(root_path, &churn);
    mx_top_t top_churn = {0}, top_risky = {0};
    long long churn_total_commits = 0;
    for (int i = 0; i < churn.key_count; i++) {
        const char *file = churn.keys[i];
        long long commits = (intptr_t)cbm_ht_get(churn.counts, file);
        churn_total_commits += commits;
        mx_top_offer(&top_churn, NULL, NULL, file, commits);
        intptr_t max_cplx = file_cplx ? (intptr_t)cbm_ht_get(file_cplx, file) : 0;
        if (max_cplx >= MX_CHURN_MIN_CPLX)
            mx_top_offer2(&top_risky, NULL, NULL, file, commits * (long long)max_cplx,
                          commits);
    }

    /* ── Serialize ───────────────────────────────────────────── */
    yyjson_mut_val *totals = yyjson_mut_obj(doc);
    yyjson_mut_obj_add_int(doc, totals, "callables", callables);
    yyjson_mut_obj_add_int(doc, totals, "dead", dead);
    yyjson_mut_obj_add_int(doc, totals, "tested_symbols", tested);
    yyjson_mut_obj_add_int(doc, totals, "similar_edges", similar_edges);
    yyjson_mut_obj_add_int(doc, totals, "missed_files", missed_files);
    yyjson_mut_obj_add_int(doc, totals, "exported", exported);
    yyjson_mut_obj_add_int(doc, totals, "documented_exported", documented_exported);
    yyjson_mut_obj_add_real(doc, totals, "avg_complexity",
                            callables > 0 ? (double)cplx_sum / (double)callables : 0.0);
    yyjson_mut_obj_add_int(doc, totals, "files", total_files);
    yyjson_mut_obj_add_val(doc, root, "totals", totals);

    yyjson_mut_val *certainty = yyjson_mut_obj(doc);
    yyjson_mut_obj_add_int(doc, certainty, "calls", calls_edges);
    yyjson_mut_obj_add_int(doc, certainty, "call_reference", ref_edges);
    yyjson_mut_obj_add_int(doc, certainty, "usage", usage_edges);
    yyjson_mut_obj_add_val(doc, root, "certainty", certainty);

    yyjson_mut_val *cplx_arr = yyjson_mut_arr(doc);
    for (int i = 0; i < 6; i++)
        yyjson_mut_arr_add_int(doc, cplx_arr, cplx_hist[i]);
    yyjson_mut_obj_add_val(doc, root, "complexity_hist", cplx_arr);
    yyjson_mut_val *line_arr = yyjson_mut_arr(doc);
    for (int i = 0; i < 5; i++)
        yyjson_mut_arr_add_int(doc, line_arr, line_hist[i]);
    yyjson_mut_obj_add_val(doc, root, "lines_hist", line_arr);

    mx_top_json(doc, root, "top_complex", &top_complex);
    mx_top_json(doc, root, "top_cognitive", &top_cognitive);
    mx_top_json(doc, root, "top_long", &top_long);
    mx_top_json(doc, root, "top_churn", &top_churn);
    mx_top_json(doc, root, "top_churn_complex", &top_risky);
    yyjson_mut_obj_add_bool(doc, root, "churn_available", churn.counts != NULL);
    yyjson_mut_obj_add_int(doc, root, "churn_total_commits", churn_total_commits);
    yyjson_mut_obj_add_int(doc, root, "churn_total_files", churn.key_count);

    long long callish = calls_edges + ref_edges + usage_edges;
    mx_history_append_and_emit(doc, root, project, stamp, callables, dead,
                               callables > 0 ? (double)cplx_sum / (double)callables : 0.0,
                               tested, usage_edges, callish);

    mx_top_free(&top_complex);
    mx_top_free(&top_cognitive);
    mx_top_free(&top_long);
    mx_top_free(&top_churn);
    mx_top_free(&top_risky);
    mx_churn_free(&churn);
    cbm_ht_free(file_cplx);
    for (int i = 0; i < file_key_count; i++)
        free(file_keys[i]);
    free(file_keys);

    char *json = yyjson_mut_write(doc, 0, NULL);
    yyjson_mut_doc_free(doc);
    return json;
}

char *cbm_atlas_metrics_json(cbm_store_t *store, const char *project) {
    if (!store || !project)
        return NULL;
    char stamp[128];
    char root_path[CBM_SZ_1K];
    mx_project_stamp(store, project, stamp, sizeof(stamp), root_path, sizeof(root_path));
    char key[1280];
    snprintf(key, sizeof(key), "%s|%s", project, stamp);
    pthread_mutex_lock(&g_mx_mu);
    if (g_mx_cache.json && strcmp(g_mx_cache.key, key) == 0) {
        char *copy = strdup(g_mx_cache.json);
        pthread_mutex_unlock(&g_mx_mu);
        return copy;
    }
    pthread_mutex_unlock(&g_mx_mu);

    char *json = mx_build_json(store, project, stamp, root_path);
    if (!json)
        return NULL;
    pthread_mutex_lock(&g_mx_mu);
    free(g_mx_cache.json);
    g_mx_cache.json = strdup(json);
    snprintf(g_mx_cache.key, sizeof(g_mx_cache.key), "%s", key);
    pthread_mutex_unlock(&g_mx_mu);
    return json;
}
