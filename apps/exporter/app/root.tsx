import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import "@luluguard/ui/globals.css";

import { AppProviders } from "./providers";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/x-icon;base64,AA" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  );
}

export function HydrateFallback() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary font-display text-lg font-bold text-primary-foreground">
          LG
        </div>
        <p className="font-display text-lg font-semibold">
          LuLuGuard 正在準備簽署頁面
        </p>
        <p className="mt-1 text-sm text-muted-foreground">載入出口商資料…</p>
      </div>
    </main>
  );
}
