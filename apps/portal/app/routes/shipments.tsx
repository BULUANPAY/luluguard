import { useListShipments } from "@luluguard/api-client";
import { Button } from "@luluguard/ui/components/button";
import { Card } from "@luluguard/ui/components/card";
import { Download, Plus } from "lucide-react";
import { useSearchParams } from "react-router";

import { Can } from "../features/auth/can";
import { ShipmentSearchForm } from "../features/shipments/shipment-search-form";
import { ShipmentTable } from "../features/shipments/shipment-table";

export function meta() {
  return [{ title: "貨件｜LuLuGuard" }];
}

export default function ShipmentsRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const { data: shipments = [], isPending, isError } = useListShipments(
    search ? { search } : undefined,
  );

  const updateSearch = (value: string) => {
    setSearchParams(value ? { search: value } : {}, { replace: true });
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-primary">貨運管理</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">所有貨件</h1>
          <p className="mt-1 text-sm text-muted-foreground">追蹤進度、文件與報關狀態。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline"><Download className="size-4" />匯出</Button>
          <Can permission="shipment:create"><Button><Plus className="size-4" />新增貨件</Button></Can>
        </div>
      </section>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
          <ShipmentSearchForm initialSearch={search} onSearch={updateSearch} />
          <p className="pt-2 text-sm text-muted-foreground">{isPending ? "讀取中…" : `${shipments.length} 筆結果`}</p>
        </div>
        {isError ? (
          <div className="grid min-h-56 place-items-center text-sm text-red-700">貨件讀取失敗，請重新整理。</div>
        ) : (
          <ShipmentTable shipments={shipments} />
        )}
      </Card>
    </div>
  );
}
