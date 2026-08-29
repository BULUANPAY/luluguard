import { useListShipments } from "@luluguard/api-client";
import { Badge } from "@luluguard/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@luluguard/ui/components/card";
import { ArrowUpRight, CircleCheckBig, Clock3, FileWarning, Ship } from "lucide-react";
import { Link } from "react-router";

import { useSession } from "../features/auth/session-context";
import { ShipmentStatusBadge } from "../features/shipments/shipment-status";

export function meta() {
  return [
    { title: "工作總覽｜LuLuGuard" },
    { name: "description", content: "LuLuGuard 進出口協作工作區" },
  ];
}

export default function DashboardRoute() {
  const { session } = useSession();
  const { data: shipments = [], isPending } = useListShipments();

  const pendingDocuments = shipments.filter(
    ({ status }) => status === "pending-documents",
  ).length;
  const inReview = shipments.filter(({ status }) => status === "customs-review").length;
  const released = shipments.filter(({ status }) => status === "released").length;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge className="border-primary/15 bg-primary/5 text-primary">{organizationKindLabel[session.activeOrganization.kind]}</Badge>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">早安，{session.user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">這是 {session.activeOrganization.name} 今天需要處理的事項。</p>
        </div>
        <p className="rounded-xl border border-border bg-white/70 px-4 py-2 text-sm text-muted-foreground shadow-sm">資料更新於剛剛</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Ship} label="進行中貨件" value={isPending ? "—" : shipments.length - released} tone="green" />
        <MetricCard icon={FileWarning} label="待補文件" value={isPending ? "—" : pendingDocuments} tone="amber" />
        <MetricCard icon={Clock3} label="海關審核中" value={isPending ? "—" : inReview} tone="violet" />
        <MetricCard icon={CircleCheckBig} label="本月已放行" value={isPending ? "—" : released} tone="blue" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.55fr_0.8fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>近期貨件</CardTitle>
              <CardDescription>依最近更新時間排列</CardDescription>
            </div>
            <Link className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline" to="/shipments">查看全部 <ArrowUpRight className="size-4" /></Link>
          </CardHeader>
          <CardContent className="space-y-1 px-3">
            {shipments.slice(0, 4).map((shipment) => (
              <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl px-3 py-3 hover:bg-muted/50" key={shipment.id}>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-bold">{shipment.reference}</p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{shipment.origin} → {shipment.destination} · ETA {shipment.eta}</p>
                </div>
                <ShipmentStatusBadge status={shipment.status} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="overflow-hidden bg-[#173c34] text-white">
          <CardHeader>
            <CardTitle>今日待辦</CardTitle>
            <CardDescription className="text-white/55">優先處理會影響通關的項目</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Task number="01" title="補齊商業發票" meta="LG-IMP-240829-01" />
            <Task number="02" title="確認稅則分類" meta="LG-IMP-240827-08" />
            <Task number="03" title="核准報關委任" meta="今天 16:00 前" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

const organizationKindLabel = {
  importer: "進口商工作區",
  exporter: "出口商工作區",
  "customs-broker": "報關行工作區",
} as const;

function MetricCard({ icon: Icon, label, value, tone }: { icon: typeof Ship; label: string; value: number | string; tone: "green" | "amber" | "violet" | "blue" }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
    blue: "bg-sky-50 text-sky-700",
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-3 font-display text-3xl font-bold tracking-tight">{value}</p>
        </div>
        <span className={`grid size-10 place-items-center rounded-xl ${tones[tone]}`}><Icon className="size-5" /></span>
      </div>
    </Card>
  );
}

function Task({ number, title, meta }: { number: string; title: string; meta: string }) {
  return (
    <button className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10" type="button">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#d9f99d] text-xs font-black text-[#173c34]">{number}</span>
      <span className="min-w-0"><span className="block truncate text-sm font-semibold">{title}</span><span className="mt-0.5 block truncate text-xs text-white/50">{meta}</span></span>
    </button>
  );
}
