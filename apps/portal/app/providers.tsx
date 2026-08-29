import { setDevelopmentApiFetcher } from "@luluguard/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { SessionProvider } from "./features/auth/session-context";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );
  const [mockReady, setMockReady] = useState(!import.meta.env.DEV);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    let cancelled = false;

    void import("./mocks/fetcher").then(({ mockApiFetch }) => {
      if (cancelled) return;
      setDevelopmentApiFetcher(mockApiFetch);
      setMockReady(true);
    });

    return () => {
      cancelled = true;
      setDevelopmentApiFetcher(undefined);
    };
  }, []);

  if (!mockReady) {
    return <HydratingApp />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}

function HydratingApp() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 size-2 animate-pulse rounded-full bg-primary" />
        <p className="text-sm font-medium text-muted-foreground">正在準備本機 API 資料…</p>
      </div>
    </main>
  );
}
