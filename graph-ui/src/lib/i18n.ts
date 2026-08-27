import { useEffect, useState } from "react";

export type UiLanguage = "en" | "zh";

export const messages = {
  en: {
    tabs: {
      overview: "Overview",
      modules: "Modules",
      graph: "Galaxy",
      flows: "Flows",
      changes: "Changes",
      dashboard: "Dashboard",
      projects: "Projects",
      control: "Control",
    },
    switcher: {
      select: "Select a project…",
      search: "Search projects…",
      manage: "manage & index",
    },
    common: {
      cancel: "Cancel",
      refresh: "Refresh",
      loading: "Loading...",
      save: "Save",
      saving: "Saving...",
      delete: "Delete",
      noMatches: "No matches",
      dismiss: "Dismiss",
    },
    graph: {
      selectedLabel: "Graph",
      search: "Search...",
      clearSelection: "Clear selection",
      folders: "Folders",
    },
    projects: {
      indexedProjects: "Indexed Projects",
      noIndexedProjects: "No indexed projects",
      indexFirstRepository: "Index your first repository",
      viewGraph: "View Graph",
      nodes: "nodes",
      edges: "edges",
      deleteTitle: "Delete index",
      deleteConfirm: (name: string) => `Delete index for "${name}"?`,
      healthHealthy: "Database healthy",
      healthMissing: "Database missing",
      healthCorrupt: "Database unhealthy",
      healthChecking: "Checking...",
      indexingInProgress: "Indexing in progress",
      indexingFailed: "Indexing failed",
    },
    index: {
      newIndex: "New Index",
      selectRepositoryFolder: "Select Repository Folder",
      instructions: "Navigate to the project root and click \"Index This Folder\".",
      repositoryPath: "Repository path",
      projectName: "Project ID (optional — permanent, cannot be renamed)",
      projectNamePlaceholder: "Derived from folder name if blank",
      projectNameHelp: "Becomes the database name and query prefix. Leave blank to derive it from the path.",
      filterFolders: "Filter folders",
      noSubdirectories: "No subdirectories",
      indexThisFolder: "Index This Folder",
      starting: "Starting...",
      browseRoot: (path: string) => `Browse ${path}`,
      indexDirectory: (name: string) => `Index ${name}`,
    },
    adr: {
      title: "Architecture Decision Record",
      lastUpdated: "Last updated",
    },
    wiki: {
      whyMatters: "Why this matters",
      howComputed: "How it's computed",
      notCovered: "What this does not cover",
      whereAppears: "Where it appears",
      pairedWith: "Paired with",
      back: "Back",
      close: "Close",
      clickForMore: "click for more →",
    },
    questions: {
      title: "What can Atlas answer?",
      answers: "answers",
      partial: "partial",
      lacks: "not yet",
      missingPrefix: "missing:",
      summary: (answers: number, partial: number, lacks: number) =>
        `${answers} answered · ${partial} partial · ${lacks} not yet`,
    },
    impact: {
      heading: "If you change this",
      nothingCalls:
        "Nothing recorded calls this — changes here surface only where it is referenced dynamically.",
      sentence: (reachable: number, callableTotal: number, regionTotal: number) =>
        `${reachable.toLocaleString("en-US")} of ${callableTotal.toLocaleString("en-US")} callables can reach this — ${regionTotal.toLocaleString("en-US")} region${regionTotal === 1 ? "" : "s"} could notice.`,
      cappedSuffix: " (walk capped — the true count is higher)",
      runTheseFirst: "Run these first",
      noTestReaches:
        "⚠ No test reaches this symbol — nothing will catch a regression here automatically.",
      basisFootnote:
        "Static CALLS edges only — dynamic dispatch and reflection are not counted; treat the count as a floor.",
    },
    history: {
      whyHere: "Why is this here?",
      docstringIntro:
        "The docstring above is the stated intent; below is the recorded history.",
      trace: "Trace this symbol's history",
      reading: "Reading git history…",
      unavailable: (reason: string) => `History unavailable: ${reason}`,
      noneReadable: "No git history is readable for this symbol's file.",
      noneForRange: "No commits recorded for this line range.",
      capped: (max: number) => `showing ${max} (capped)`,
      footnote:
        "History follows this symbol's line range through renames (git log -L). PR and issue links open the forge — titles are not fetched.",
    },
    who: {
      heading: "Who can help",
      loading: "Reading authorship…",
      unavailable: (reason: string) => `Authorship unavailable: ${reason}`,
      noHistory: "No git history is readable for this project.",
      noCommits: "No recorded commits touch this file in the window (1y).",
      commitsHere: (n: number) =>
        `${n.toLocaleString("en-US")} commit${n === 1 ? "" : "s"} to this file this year`,
      breadth: (n: number) =>
        `active in ${n.toLocaleString("en-US")} file${n === 1 ? "" : "s"} repo-wide`,
      lastTouched: (date: string) => `last touched ${date}`,
      footer: (total: number, shown: number) =>
        total > shown
          ? `${total.toLocaleString("en-US")} people have recorded history here — showing ${shown} of ${total.toLocaleString("en-US")}`
          : `${total.toLocaleString("en-US")} ${total === 1 ? "person has" : "people have"} recorded history here`,
    },
    observed: {
      word: "observed",
      allObserved: "This whole path was observed in recorded runs.",
      freshness: (label: string) =>
        `Runtime markers from recorded runs (${label}). Unmarked hops are possible, not dead — runs only cover what they exercised.`,
      title: (label: string, date: string) => `ran in ${label} · last ${date}`,
    },
    control: {
      panel: "Control Panel",
      totalCpu: "Total CPU",
      totalRam: "Total RAM",
      processes: "Processes",
      selfRam: "Self RAM",
      activeProcesses: "Active Processes",
      processLogs: "Process Logs",
      noProcesses: "No processes found",
      noLogs: "No logs yet",
      thisProcess: "THIS",
      uptime: "Uptime",
    },
  },
  zh: {
    tabs: {
      overview: "总览",
      modules: "模块",
      graph: "星系",
      flows: "流程",
      changes: "变更",
      dashboard: "仪表盘",
      projects: "项目",
      control: "控制",
    },
    switcher: {
      select: "选择项目…",
      search: "搜索项目…",
      manage: "管理与索引",
    },
    common: {
      cancel: "取消",
      refresh: "刷新",
      loading: "加载中...",
      save: "保存",
      saving: "保存中...",
      delete: "删除",
      noMatches: "无匹配结果",
      dismiss: "关闭",
    },
    graph: {
      selectedLabel: "图谱",
      search: "搜索...",
      clearSelection: "清除选择",
      folders: "目录",
    },
    projects: {
      indexedProjects: "已索引项目",
      noIndexedProjects: "暂无已索引项目",
      indexFirstRepository: "索引第一个仓库",
      viewGraph: "查看图谱",
      nodes: "节点",
      edges: "边",
      deleteTitle: "删除索引",
      deleteConfirm: (name: string) => `删除 "${name}" 的索引？`,
      healthHealthy: "数据库正常",
      healthMissing: "数据库缺失",
      healthCorrupt: "数据库异常",
      healthChecking: "检查中...",
      indexingInProgress: "正在索引",
      indexingFailed: "索引失败",
    },
    index: {
      newIndex: "新建索引",
      selectRepositoryFolder: "选择仓库目录",
      instructions: "导航到项目根目录，然后点击“索引此目录”。",
      repositoryPath: "仓库路径",
      projectName: "项目 ID（可选，永久且不可重命名）",
      projectNamePlaceholder: "留空则从路径派生",
      projectNameHelp: "将作为数据库名称与查询前缀；留空则从路径派生。",
      filterFolders: "筛选目录",
      noSubdirectories: "没有子目录",
      indexThisFolder: "索引此目录",
      starting: "启动中...",
      browseRoot: (path: string) => `浏览 ${path}`,
      indexDirectory: (name: string) => `索引 ${name}`,
    },
    adr: {
      title: "架构决策记录",
      lastUpdated: "最后更新",
    },
    wiki: {
      whyMatters: "为什么重要",
      howComputed: "如何计算",
      notCovered: "不涵盖的内容",
      whereAppears: "出现位置",
      pairedWith: "配对指标",
      back: "返回",
      close: "关闭",
      clickForMore: "点击查看更多 →",
    },
    questions: {
      title: "Atlas 能回答什么？",
      answers: "已回答",
      partial: "部分",
      lacks: "暂缺",
      missingPrefix: "缺少:",
      summary: (answers: number, partial: number, lacks: number) =>
        `${answers} 已回答 · ${partial} 部分 · ${lacks} 暂缺`,
    },
    impact: {
      heading: "如果你改动这里",
      nothingCalls:
        "没有任何已记录的调用指向这里——改动只会在动态引用它的地方显现。",
      sentence: (reachable: number, callableTotal: number, regionTotal: number) =>
        `全仓库 ${callableTotal.toLocaleString("en-US")} 个可调用符号中，有 ${reachable.toLocaleString("en-US")} 个能到达这里——${regionTotal.toLocaleString("en-US")} 个区域可能察觉。`,
      cappedSuffix: "（遍历已达上限——真实数量更高）",
      runTheseFirst: "先跑这些测试",
      noTestReaches:
        "⚠ 没有任何测试到达这个符号——出了回归不会被自动发现。",
      basisFootnote:
        "仅统计静态 CALLS 边——动态分发与反射不计入；请把数字当作下限。",
    },
    history: {
      whyHere: "为什么会有这段代码？",
      docstringIntro: "上方的文档注释是声明的意图；下面是实际记录的历史。",
      trace: "追溯这个符号的历史",
      reading: "正在读取 git 历史…",
      unavailable: (reason: string) => `历史不可用：${reason}`,
      noneReadable: "这个符号所在的文件没有可读的 git 历史。",
      noneForRange: "这段行范围没有记录到任何提交。",
      capped: (max: number) => `仅显示 ${max} 条（已达上限）`,
      footnote:
        "历史沿这个符号自身的行范围追踪，可跨重命名（git log -L）。PR 与 issue 链接指向代码托管平台——标题不会被抓取。",
    },
    who: {
      heading: "可求助的人",
      loading: "正在读取作者记录…",
      unavailable: (reason: string) => `作者记录不可用：${reason}`,
      noHistory: "这个项目没有可读的 git 历史。",
      noCommits: "窗口期（1 年）内没有提交记录触及这个文件。",
      commitsHere: (n: number) => `今年对此文件提交 ${n.toLocaleString("en-US")} 次`,
      breadth: (n: number) => `活跃于全仓 ${n.toLocaleString("en-US")} 个文件`,
      lastTouched: (date: string) => `最近改动 ${date}`,
      footer: (total: number, shown: number) =>
        total > shown
          ? `共 ${total.toLocaleString("en-US")} 人在这里留有提交记录——显示其中 ${shown} 位`
          : `共 ${total.toLocaleString("en-US")} 人在这里留有提交记录`,
    },
    observed: {
      word: "已观测",
      allObserved: "这条路径整体都在录制的运行中被观测到。",
      freshness: (label: string) =>
        `运行时标记来自录制的运行（${label}）。未标记的跳步只是可能执行，不代表死代码——一次运行只覆盖它实际执行到的部分。`,
      title: (label: string, date: string) => `曾在 ${label} 中执行 · 最近 ${date}`,
    },
    control: {
      panel: "控制面板",
      totalCpu: "总 CPU",
      totalRam: "总内存",
      processes: "进程",
      selfRam: "自身内存",
      activeProcesses: "活动进程",
      processLogs: "进程日志",
      noProcesses: "未找到进程",
      noLogs: "暂无日志",
      thisProcess: "本进程",
      uptime: "运行时间",
    },
  },
} as const;

export type UiMessages = (typeof messages)[UiLanguage];

export function detectLanguage(acceptLanguage?: string | null, override?: string | null): UiLanguage {
  if (override === "zh" || override === "en") return override;
  if (!acceptLanguage) return "en";

  // Ranked by q, not by whether "zh" appears anywhere. A substring test served
  // Chinese for "en-US,en;q=0.9,zh;q=0.5", where English is clearly preferred,
  // and for "zh;q=0, en", where q=0 means Chinese is unacceptable.
  const best = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(p)).find(Boolean);
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q[1]) : 1 };
    })
    .filter(({ tag, q }) => tag && Number.isFinite(q) && q > 0)
    .sort((a, b) => b.q - a.q)
    .find(({ tag }) => tag.split("-")[0] === "zh" || tag.split("-")[0] === "en");

  return best?.tag.startsWith("zh") ? "zh" : "en";
}

let cachedLanguage: UiLanguage = "en";
let languageLoaded = false;
let languageRequest: Promise<UiLanguage> | null = null;
const languageListeners = new Set<(lang: UiLanguage) => void>();

function loadUiLanguage(): Promise<UiLanguage> {
  if (languageLoaded) return Promise.resolve(cachedLanguage);
  if (languageRequest) return languageRequest;

  languageRequest = fetch("/api/ui-config")
    .then((r) => r.json())
    .then((data) => detectLanguage(null, data?.lang))
    .catch(() => detectLanguage(navigator.language))
    .then((lang) => {
      cachedLanguage = lang;
      languageLoaded = true;
      for (const listener of languageListeners) listener(lang);
      return lang;
    })
    .finally(() => {
      languageRequest = null;
    });

  return languageRequest;
}

/* The active language itself — for content that localizes outside the
 * message catalog (wiki entries, question families carry co-located zh
 * fields with per-field English fallback). */
export function useUiLanguage(): UiLanguage {
  const [lang, setLang] = useState<UiLanguage>(cachedLanguage);

  useEffect(() => {
    let cancelled = false;
    languageListeners.add(setLang);
    void loadUiLanguage().then((nextLang) => {
      if (!cancelled) setLang(nextLang);
    });
    return () => {
      cancelled = true;
      languageListeners.delete(setLang);
    };
  }, []);

  return lang;
}

export function useUiMessages(): UiMessages {
  return messages[useUiLanguage()];
}
