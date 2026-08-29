import type { ShipmentStatus } from "@luluguard/api-client";
import { Badge } from "@luluguard/ui/components/badge";

const statusConfig: Record<
  ShipmentStatus,
  { label: string; className: string }
> = {
  "pending-documents": {
    label: "待補文件",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  "ready-for-declaration": {
    label: "可申報",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  "customs-review": {
    label: "海關審核",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  released: {
    label: "已放行",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
};

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  const config = statusConfig[status];
  return <Badge className={config.className}>{config.label}</Badge>;
}
