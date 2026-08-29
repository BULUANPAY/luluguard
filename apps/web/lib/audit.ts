import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export type AuditStatus = "attempted" | "succeeded" | "failed" | "blocked";

export interface AuditEvent {
  traceId: string;
  component: string;
  action: string;
  status: AuditStatus;
  actor?: string;
  spanId?: string;
  parentSpanId?: string;
  data?: unknown;
}

const secretKey =
  /(authorization|api[-_]?key|private[-_]?key|secret|password|cookie|token|payment[-_]?signature)/i;
const cwd = process.cwd();
const appRoot = basename(cwd) === "web" ? cwd : resolve(cwd, "apps/web");
const auditPath =
  process.env.AUDIT_LOG_PATH ?? resolve(appRoot, "logs/audit.jsonl");
const enabled = process.env.AUDIT_LOG_ENABLED !== "false";
const maxValueLength = Number(process.env.AUDIT_LOG_MAX_VALUE_LENGTH ?? 8_000);
let previousHash: string | undefined;

function sanitize(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): unknown {
  if (secretKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value.length > maxValueLength
      ? `${value.slice(0, maxValueLength)}...[TRUNCATED ${value.length - maxValueLength} chars]`
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
  if (previousHash !== undefined || !existsSync(auditPath)) return;
  const lines = readFileSync(auditPath, "utf8").trim().split("\n");
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
  if (!enabled) return;
  loadPreviousHash();
  const entry = {
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
    auditId: newAuditId("AUDIT"),
    service: "luluguard-web",
    ...event,
    data: sanitize(event.data),
    previousHash: previousHash ?? "GENESIS",
  };
  const canonical = JSON.stringify(entry);
  const hash = createHash("sha256").update(canonical).digest("hex");
  mkdirSync(dirname(auditPath), { recursive: true });
  appendFileSync(auditPath, `${JSON.stringify({ ...entry, hash })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  previousHash = hash;
}
