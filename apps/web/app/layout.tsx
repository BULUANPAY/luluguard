import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "x402 進口商 AI Agent",
  description: "使用 AI、MCP 與 x402 USDC 的進口報關示範"
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
