import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

export type AuditStatus = "attempted" | "succeeded" | "failed" | "blocked";

export interface AuditEvent {
  traceId: string;
  component: string;
  action: string;
  status: AuditStatus;
  actor?: string;
  spanId?: string;
  parentSpanId?: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  agentRunId?: string;
  data?: unknown;
}

const secretKey =
  /(authorization|api[-_]?key|private[-_]?key|secret|password|cookie|token|payment[-_]?signature)/i;
let previousHash: string | undefined;
type AuditIdentity = Pick<
  AuditEvent,
  "tenantId" | "userId" | "sessionId" | "agentId" | "agentRunId"
>;
const traceIdentities = new Map<string, AuditIdentity>();

function traceIdentity(event: AuditEvent): AuditIdentity {
  const known = traceIdentities.get(event.traceId) ?? {};
  const identity = {
    tenantId: event.tenantId ?? known.tenantId,
    userId: event.userId ?? known.userId,
    sessionId: event.sessionId ?? known.sessionId,
    agentId: event.agentId ?? known.agentId,
    agentRunId: event.agentRunId ?? known.agentRunId,
  };
  traceIdentities.set(event.traceId, identity);
  return identity;
}

export function clearAuditTraceContext(traceId: string) {
  traceIdentities.delete(traceId);
}

function sanitize(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): unknown {
  if (secretKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value.length > config.audit.maxValueLength
      ? `${value.slice(0, config.audit.maxValueLength)}...[TRUNCATED ${value.length - config.audit.maxValueLength} chars]`
      : value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value))
    return value.map((item) => sanitize(item, key, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitize(child, childKey, seen),
      ]),
    );
  }
  return value;
}

function loadPreviousHash() {
  if (previousHash !== undefined || !existsSync(config.audit.path)) return;
  const lines = readFileSync(config.audit.path, "utf8").trim().split("\n");
  if (!lines.at(-1)) return;
  try {
    previousHash =
      (JSON.parse(lines.at(-1)!) as { hash?: string }).hash ?? "GENESIS";
  } catch {
    previousHash = "INVALID_PREVIOUS_ENTRY";
  }
}

export function newAuditId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function writeAudit(event: AuditEvent) {
  if (!config.audit.enabled) return;
  loadPreviousHash();
  const entry = {
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
    auditId: newAuditId("AUDIT"),
    service: "luluguard-importer-mcp",
    ...event,
    ...traceIdentity(event),
    data: sanitize(event.data),
    previousHash: previousHash ?? "GENESIS",
  };
  const canonical = JSON.stringify(entry);
  const hash = createHash("sha256").update(canonical).digest("hex");
  mkdirSync(dirname(config.audit.path), { recursive: true });
  appendFileSync(config.audit.path, `${JSON.stringify({ ...entry, hash })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  previousHash = hash;
}
