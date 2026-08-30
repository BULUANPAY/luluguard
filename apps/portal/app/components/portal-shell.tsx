import { Button } from "@luluguard/ui/components/button";
import {
  ChevronDown,
  CircleUserRound,
  FileInput,
  FilePlus2,
  LayoutDashboard,
  LifeBuoy,
  Plus,
  Search,
  Ship,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";

import { Can } from "../features/auth/can";
import { useSession } from "../features/auth/session-context";

const navigation = [
  { to: "/", label: "總覽", icon: LayoutDashboard, end: true },
  { to: "/shipments", label: "貨件", icon: Ship, end: false },
] as const;

export function PortalShell({ children }: { children: ReactNode }) {
  const { session, switchOrganization } = useSession();
  const navigate = useNavigate();
  const isExporter = session.activeOrganization.kind === "exporter";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[252px_1fr]">
      <aside className="border-b border-border bg-[#173c34] text-white lg:min-h-screen lg:border-b-0 lg:border-r lg:border-white/10">
        <div className="flex h-16 items-center justify-between px-5 lg:h-20">
          <NavLink className="flex items-center gap-3" to="/">
            <span className="grid size-9 place-items-center rounded-xl bg-[#d9f99d] text-sm font-black text-[#173c34]">
              LG
            </span>
            <span>
              <span className="block font-display text-base font-bold tracking-tight">
                LuLuGuard
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
                Trade workspace
              </span>
            </span>
          </NavLink>
          <Button
            className="text-white hover:bg-white/10 lg:hidden"
            size="icon"
            variant="ghost"
            aria-label="搜尋"
          >
            <Search className="size-4" />
          </Button>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:px-4 lg:pb-0">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              className={({ isActive }) =>
                `flex min-w-fit items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-white text-[#173c34]"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`
              }
              end={end}
              to={to}
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto hidden px-4 pb-5 pt-8 lg:absolute lg:bottom-0 lg:block lg:w-[252px]">
          <a
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white"
            href="mailto:support@luluguard.local"
          >
            <LifeBuoy className="size-4" />
            需要協助？
          </a>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border/80 bg-white/75 px-5 py-3 backdrop-blur lg:px-8">
          <label className="relative min-w-[220px] max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-10 w-full rounded-xl border border-border bg-muted/60 pl-9 pr-3 text-sm outline-none focus:border-primary"
              placeholder="搜尋貨件、提單或文件"
              type="search"
            />
          </label>

          <div className="flex items-center gap-2">
            <label className="relative hidden sm:block">
              <span className="sr-only">目前公司</span>
              <select
                className="h-10 appearance-none rounded-xl border border-border bg-white pl-3 pr-9 text-sm font-semibold outline-none focus:border-primary"
                onChange={(event) => switchOrganization(event.target.value)}
                value={session.activeOrganization.id}
              >
                {session.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {formatOrganizationLabel(
                      organization.name,
                      organization.kind,
                    )}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </label>

            {isExporter ? (
              <>
                <Can permission="export-object:create">
                  <Button
                    onClick={() => navigate("/exports/new")}
                    variant="outline"
                  >
                    <FilePlus2 className="size-4" />
                    <span className="hidden sm:inline">新增出口物件</span>
                    <span className="sm:hidden">物件</span>
                  </Button>
                </Can>
                <Can permission="document:upload">
                  <Button onClick={() => navigate("/exports/documents/new")}>
                    <FileInput className="size-4" />
                    <span className="hidden sm:inline">填寫並簽署文件</span>
                    <span className="sm:hidden">文件</span>
                  </Button>
                </Can>
              </>
            ) : (
              <Can permission="shipment:create">
                <Button>
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">新增貨件</span>
                  <span className="sm:hidden">新增</span>
                </Button>
              </Can>
            )}

            <div className="ml-1 flex items-center gap-2 border-l border-border pl-3">
              <CircleUserRound className="size-8 text-muted-foreground" />
              <span className="hidden text-left lg:block">
                <span className="block text-sm font-semibold leading-tight">
                  {session.user.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  營運管理員
                </span>
              </span>
            </div>
          </div>
        </header>

        <main className="px-5 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

const organizationKindLabels: Record<string, string> = {
  exporter: "出口商",
  "customs-broker": "報關行",
};

function formatOrganizationLabel(name: string, kind: string) {
  return `${name} - ${organizationKindLabels[kind] ?? kind}`;
}
