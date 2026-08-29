import { config } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function configuredLevel(): LogLevel {
  const value = config.log.level.toLowerCase();
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

export function log(level: LogLevel, component: string, event: string, data = {}) {
  if (priorities[level] < priorities[configuredLevel()]) return;
  // MCP stdio reserves stdout for protocol messages, so application logs use stderr.
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      component,
      event,
      ...data
    })
  );
}
