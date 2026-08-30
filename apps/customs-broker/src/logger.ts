import type { BrokerConfig } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createLogger(config: Pick<BrokerConfig, "logLevel">) {
  const configured = config.logLevel.toLowerCase();
  const threshold: LogLevel = configured === "debug" || configured === "warn" || configured === "error"
    ? configured
    : "info";

  return (level: LogLevel, event: string, data: Record<string, unknown> = {}) => {
    if (priorities[level] < priorities[threshold]) return;
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      component: "customs-broker",
      event,
      ...data
    }));
  };
}
