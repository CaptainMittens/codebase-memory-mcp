import { useCallback, useEffect, useState } from "react";
import { GraphTab } from "./components/GraphTab";
import { StatsTab } from "./components/StatsTab";
import { ControlTab } from "./components/ControlTab";
import { OverviewTab } from "./components/OverviewTab";
import { ModulesTab } from "./components/ModulesTab";
import { SymbolTab } from "./components/SymbolTab";
import { FlowsTab } from "./components/FlowsTab";
import { ChangesTab } from "./components/ChangesTab";
import { DashboardTab } from "./components/DashboardTab";
import { CommandK } from "./components/CommandK";
import {
  PromptBasketProvider,
  PromptBasketDrawer,
} from "./components/PromptBasket";
import type { TabId } from "./lib/types";
import { useUiMessages } from "./lib/i18n";

const TAB_IDS: TabId[] = [
  "overview",
  "modules",
  "graph",
  "flows",
  "changes",
  "dashboard",
  "symbol",
  "stats",
  "control",
];

/* Tabs that need a selected project. "symbol" is reachable only via links. */
const PROJECT_TABS: TabId[] = ["overview", "modules", "graph", "flows", "changes", "dashboard"];

interface RouteState {
  tab: TabId;
  project: string | null;
  /* Deep links (#564): node/region on the galaxy, sym on the symbol page,
   * path in Modules, flow in Flows — all survive reloads and sharing. */
  node: string | null;
  region: string | null;
  sym: string | null;
  path: string;
  flow: string | null;
}

function readRoute(): RouteState {
  const params = new URLSearchParams(window.location.search);
  const rawTab = params.get("tab");
  const tab = TAB_IDS.includes(rawTab as TabId) ? (rawTab as TabId) : "stats";
  return {
    tab,
    project: params.get("project") || null,
    node: params.get("node") || null,
    region: params.get("region") || null,
    sym: params.get("sym") || null,
    path: params.get("path") || "",
    flow: params.get("flow") || null,
  };
}

function routeUrl(route: RouteState): string {
  const params = new URLSearchParams();
  params.set("tab", route.tab);
  if (route.project) params.set("project", route.project);
  if (route.region) params.set("region", route.region);
  if (route.node) params.set("node", route.node);
  if (route.sym) params.set("sym", route.sym);
  if (route.path) params.set("path", route.path);
  if (route.flow) params.set("flow", route.flow);
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

export function App() {
  const t = useUiMessages();
  const [route, setRoute] = useState<RouteState>(readRoute);
  const [commandOpen, setCommandOpen] = useState(false);
  const { tab: activeTab, project: selectedProject } = route;

  useEffect(() => {
    const initial = readRoute();
    window.history.replaceState(null, "", routeUrl(initial));
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /* ⌘K / ctrl-K anywhere. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = useCallback((next: Partial<RouteState> & { tab: TabId }) => {
    setRoute((previous) => {
      const merged: RouteState = {
        project: previous.project,
        node: null,
        region: null,
        sym: null,
        path: "",
        flow: null,
        ...next,
      } as RouteState;
      const url = routeUrl(merged);
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (url !== current) window.history.pushState(null, "", url);
      return merged;
    });
  }, []);

  const openSymbol = useCallback(
    (ref: { id?: number; qn?: string }) => {
      navigate({
        tab: "symbol",
        sym: ref.qn ?? (ref.id !== undefined ? `#${ref.id}` : null),
      });
    },
    [navigate],
  );
  const openRegion = useCallback(
    (regionId: number) => {
      navigate({ tab: "graph", region: String(regionId) });
    },
    [navigate],
  );

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "modules", label: "Modules" },
    { id: "graph", label: "Galaxy" },
    { id: "flows", label: "Flows" },
    { id: "changes", label: "Changes" },
    { id: "dashboard", label: "Dashboard" },
    { id: "stats", label: t.tabs.projects },
    { id: "control", label: t.tabs.control },
  ];

  const symbolRef = route.sym
    ? route.sym.startsWith("#")
      ? { id: Number(route.sym.slice(1)) }
      : { qn: route.sym }
    : null;

  return (
    <PromptBasketProvider>
      <div className="h-screen flex flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between px-5 h-12 border-b border-border bg-card/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-6 min-w-0">
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-[7px] h-[7px] rounded-full bg-primary" />
              <span className="text-[13px] font-semibold text-foreground/90 tracking-tight">
                CBM Atlas
              </span>
            </div>

            <nav className="flex items-center gap-0.5 overflow-x-auto">
              {tabs.map((tab) => {
                const disabled = PROJECT_TABS.includes(tab.id) && !selectedProject;
                return (
                  <button
                    key={tab.id}
                    onClick={() =>
                      navigate({
                        tab: tab.id,
                        project: tab.id === "stats" ? null : selectedProject,
                      })
                    }
                    disabled={disabled}
                    title={disabled ? "Select a project first" : undefined}
                    className={`px-3 py-1 rounded-md text-[12px] font-medium transition-all whitespace-nowrap ${
                      disabled
                        ? "text-muted-foreground/50 cursor-not-allowed"
                        : activeTab === tab.id
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-surface-3"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setCommandOpen(true)}
              className="px-2.5 py-1 rounded-md text-[13px] text-muted-foreground hover:text-foreground bg-popover hover:bg-surface-3 border border-border/40 transition-all"
              title="Search symbols and code"
            >
              ⌘K
            </button>
            {selectedProject && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-popover border border-border/30">
                <span className="text-[13px] text-primary font-mono truncate max-w-[240px]">
                  {selectedProject}
                </span>
                <button
                  onClick={() => navigate({ tab: "stats", project: null })}
                  className="text-foreground/35 hover:text-foreground/50 text-[12px] transition-colors"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 min-h-0">
          {activeTab === "overview" && selectedProject ? (
            <OverviewTab
              project={selectedProject}
              onOpenRegion={openRegion}
              onOpenSymbol={(qn) => openSymbol({ qn })}
              onOpenModules={() => navigate({ tab: "modules" })}
              onOpenFlows={() => navigate({ tab: "flows" })}
              onOpenDashboard={() => navigate({ tab: "dashboard" })}
            />
          ) : activeTab === "modules" && selectedProject ? (
            <ModulesTab
              project={selectedProject}
              path={route.path}
              onNavigatePath={(path) => navigate({ tab: "modules", path })}
              onOpenSymbol={openSymbol}
              onOpenRegion={openRegion}
            />
          ) : activeTab === "graph" ? (
            <GraphTab
              project={selectedProject}
              routeNode={route.node}
              routeRegion={route.region}
              onRouteChange={(node, region) =>
                navigate({ tab: "graph", node, region })
              }
            />
          ) : activeTab === "flows" && selectedProject ? (
            <FlowsTab
              project={selectedProject}
              flowId={route.flow !== null ? Number(route.flow) : null}
              onOpenFlow={(id) =>
                navigate({ tab: "flows", flow: id !== null ? String(id) : null })
              }
              onOpenSymbol={openSymbol}
            />
          ) : activeTab === "changes" && selectedProject ? (
            <ChangesTab project={selectedProject} onOpenSymbol={openSymbol} />
          ) : activeTab === "dashboard" && selectedProject ? (
            <DashboardTab
              project={selectedProject}
              onOpenSymbol={(ref) => openSymbol(ref)}
              onOpenModulesPath={(path) => navigate({ tab: "modules", path })}
            />
          ) : activeTab === "symbol" && selectedProject && symbolRef ? (
            <SymbolTab
              project={selectedProject}
              symbolRef={symbolRef}
              onOpenSymbol={openSymbol}
              onOpenRegion={openRegion}
            />
          ) : activeTab === "control" ? (
            <ControlTab />
          ) : (
            <StatsTab
              onSelectProject={(project) => navigate({ tab: "overview", project })}
            />
          )}
        </main>

        <CommandK
          project={selectedProject}
          open={commandOpen}
          onClose={() => setCommandOpen(false)}
          onOpenSymbol={openSymbol}
        />
        <PromptBasketDrawer project={selectedProject} />
      </div>
    </PromptBasketProvider>
  );
}
