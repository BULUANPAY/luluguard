import type { ApiFetcher } from "@luluguard/api-client";

import { sessionFixture, shipmentFixtures } from "./data";

export const mockApiFetch: ApiFetcher = async <T>(
  url: string,
  init: RequestInit,
) => {
  await new Promise((resolve) => setTimeout(resolve, 180));

  const requestUrl = new URL(url, "http://mock.luluguard.local");
  const method = init.method ?? "GET";

  if (method === "GET" && requestUrl.pathname === "/session") {
    return structuredClone(sessionFixture) as T;
  }

  if (method === "GET" && requestUrl.pathname === "/shipments") {
    const search = requestUrl.searchParams.get("search")?.trim().toLowerCase();
    const status = requestUrl.searchParams.get("status");
    const shipments = shipmentFixtures.filter((shipment) => {
      const matchesSearch =
        !search ||
        [shipment.reference, shipment.origin, shipment.destination].some((value) =>
          value.toLowerCase().includes(search),
        );
      const matchesStatus = !status || shipment.status === status;
      return matchesSearch && matchesStatus;
    });

    return structuredClone(shipments) as T;
  }

  if (method === "POST" && requestUrl.pathname === "/export-objects") {
    const body = JSON.parse(String(init.body ?? "{}")) as { reference?: string };
    return {
      accepted: true,
      reference: body.reference ?? "未命名出口物件",
      submittedAt: new Date().toISOString(),
    } as T;
  }

  throw new Error(`No development API mock for ${method} ${requestUrl.pathname}`);
};
