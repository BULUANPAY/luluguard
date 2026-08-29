import type { Shipment } from "@luluguard/api-client";
import { ArrowRight, Ship } from "lucide-react";

import { ShipmentStatusBadge } from "./shipment-status";

export function ShipmentTable({ shipments }: { shipments: Shipment[] }) {
  if (shipments.length === 0) {
    return (
      <div className="grid min-h-64 place-items-center text-center">
        <div>
          <Ship className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 font-semibold">找不到符合條件的貨件</p>
          <p className="mt-1 text-sm text-muted-foreground">請調整搜尋內容或清除篩選。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/45 text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-5 py-3 font-semibold">貨件編號</th>
            <th className="px-5 py-3 font-semibold">運送路線</th>
            <th className="px-5 py-3 font-semibold">預計抵達</th>
            <th className="px-5 py-3 font-semibold">狀態</th>
            <th className="px-5 py-3"><span className="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          {shipments.map((shipment) => (
            <tr className="border-b border-border/70 last:border-0 hover:bg-muted/30" key={shipment.id}>
              <td className="px-5 py-4 font-mono text-xs font-bold text-foreground">{shipment.reference}</td>
              <td className="px-5 py-4">
                <span className="font-semibold">{shipment.origin}</span>
                <ArrowRight className="mx-2 inline size-3.5 text-muted-foreground" />
                <span className="font-semibold">{shipment.destination}</span>
              </td>
              <td className="px-5 py-4 text-muted-foreground">{shipment.eta}</td>
              <td className="px-5 py-4"><ShipmentStatusBadge status={shipment.status} /></td>
              <td className="px-5 py-4 text-right">
                <button className="font-semibold text-primary hover:underline" type="button">查看</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
