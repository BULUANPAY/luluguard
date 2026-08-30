import type { ChatMessage } from "./ai";

export type WorkflowAction = "chat" | "precheck" | "broker_quote" | "payment";

export interface WorkflowRequest {
  messages: ChatMessage[];
  workflowAction: WorkflowAction;
  orderId?: string;
  preflightId?: string;
  quoteId?: string;
  customsAuthorizationAcceptedAt?: string;
  estimateApproved: boolean;
  paymentApproved: boolean;
}

export class WorkflowRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRequestError";
  }
}

const workflowActions = new Set<WorkflowAction>([
  "chat",
  "precheck",
  "broker_quote",
  "payment",
]);
const maxIncomingMessages = 100;
const retainedMessages = 20;
const maxMessageLength = 8_000;
const maxConversationLength = 40_000;

export function parseWorkflowRequest(value: unknown): WorkflowRequest {
  if (!isRecord(value)) throw new WorkflowRequestError("Request body 必須是 JSON object");

  const workflowAction = value.workflowAction ?? "chat";
  if (
    typeof workflowAction !== "string" ||
    !workflowActions.has(workflowAction as WorkflowAction)
  ) {
    throw new WorkflowRequestError("workflowAction 不受支援");
  }

  const incoming = Array.isArray(value.messages)
    ? value.messages
    : typeof value.message === "string"
      ? [{ role: "user", content: value.message }]
      : [];
  if (incoming.length > maxIncomingMessages) {
    throw new WorkflowRequestError(
      `messages 不可超過 ${maxIncomingMessages} 則`,
    );
  }
  const validatedMessages = incoming.map((message, index): ChatMessage => {
    if (
      !isRecord(message) ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      !message.content.trim()
    ) {
      throw new WorkflowRequestError(`messages.${index} 格式不正確`);
    }
    if (message.content.length > maxMessageLength) {
      throw new WorkflowRequestError(
        `messages.${index}.content 不可超過 ${maxMessageLength} 字元`,
      );
    }
    return { role: message.role, content: message.content };
  });
  if (
    validatedMessages.reduce(
      (total, message) => total + message.content.length,
      0,
    ) >
    maxConversationLength
  ) {
    throw new WorkflowRequestError(
      `對話內容合計不可超過 ${maxConversationLength} 字元`,
    );
  }
  const messages = validatedMessages.slice(-retainedMessages);

  const latest = messages.at(-1);
  if (!latest || latest.role !== "user") {
    throw new WorkflowRequestError("最後一則訊息必須是使用者訊息");
  }

  const action = workflowAction as WorkflowAction;
  const orderId = optionalIdentifier(value.orderId, "orderId");
  const preflightId = optionalIdentifier(value.preflightId, "preflightId");
  const quoteId = optionalIdentifier(value.quoteId, "quoteId");
  const customsAuthorizationAcceptedAt = optionalIsoTimestamp(
    value.customsAuthorizationAcceptedAt,
    "customsAuthorizationAcceptedAt",
  );
  const estimateDenied =
    /(不|未|拒絕).{0,6}(確認|同意|核准).{0,16}(預估|估價)|(不確認|不同意|不核准).{0,16}(預估|估價)/i.test(
      latest.content,
    );
  const estimateApproved = !estimateDenied &&
    /(確認|同意|核准).{0,16}(預估|估價)|(預估|估價).{0,16}(確認|同意|核准)|confirm.{0,16}estimate/i.test(
      latest.content,
    );
  const paymentDenied =
    /(不|未|拒絕|取消).{0,6}(同意|核准|確認|付款|支付)|(不同意|不核准|不確認|不要|取消).{0,12}(付款|支付)/i.test(
      latest.content,
    );
  const paymentApproved = !paymentDenied &&
    /(同意|核准|確認).{0,12}(付款|支付)|(付款|支付).{0,12}(同意|核准|確認)|approve.{0,12}pay/i.test(
      latest.content,
    );

  if (action === "precheck" && !orderId) {
    throw new WorkflowRequestError("文件預檢需要 orderId");
  }
  if (
    action === "broker_quote" &&
    (!orderId ||
      !preflightId ||
      !estimateApproved ||
      !customsAuthorizationAcceptedAt)
  ) {
    throw new WorkflowRequestError(
      "詢價需要 orderId、preflightId、明確的預估確認與委任書同意紀錄",
    );
  }
  if (action === "payment" && (!orderId || !quoteId || !paymentApproved)) {
    throw new WorkflowRequestError(
      "付款需要 orderId、quoteId 與使用者明確的付款核准",
    );
  }

  return {
    messages,
    workflowAction: action,
    orderId,
    preflightId,
    quoteId,
    customsAuthorizationAcceptedAt,
    estimateApproved,
    paymentApproved,
  };
}

function optionalIsoTimestamp(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new WorkflowRequestError(`${name} 格式不正確`);
  }
  return new Date(value).toISOString();
}

function optionalIdentifier(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 128) {
    throw new WorkflowRequestError(`${name} 格式不正確`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
