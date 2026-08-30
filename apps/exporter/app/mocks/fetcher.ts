import type { ApiFetcher } from "@luluguard/api-client";

import { sessionFixture } from "./data";

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

  throw new Error(
    `No development API mock for ${method} ${requestUrl.pathname}`,
  );
};
