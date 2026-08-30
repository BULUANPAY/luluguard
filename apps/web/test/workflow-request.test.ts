import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseWorkflowRequest,
  WorkflowRequestError,
} from "../lib/workflow-request";

test("accepts the explicit payment confirmation sent by the UI", () => {
  const request = parseWorkflowRequest({
    messages: [
      {
        role: "user",
        content: "我明確同意並核准支付訂單 ORDER-1、報價 QUOTE-1 的報關行服務費。",
      },
    ],
    workflowAction: "payment",
    orderId: "ORDER-1",
    quoteId: "QUOTE-1",
  });

  assert.equal(request.paymentApproved, true);
  assert.equal(request.workflowAction, "payment");
});

test("accepts the estimate and authorization confirmation sent by the UI", () => {
  const request = parseWorkflowRequest({
    messages: [
      {
        role: "user",
        content:
          "我確認進口商預估，並已閱讀及同意訂單 ORDER-1 的報關作業委託書，授權將本訂單文件送交報關行詢價並比較差異。",
      },
    ],
    workflowAction: "broker_quote",
    orderId: "ORDER-1",
    preflightId: "PREFLIGHT-1",
  });

  assert.equal(request.estimateApproved, true);
  assert.equal(request.workflowAction, "broker_quote");
});

test("rejects a payment action without explicit approval", () => {
  assert.throws(
    () =>
      parseWorkflowRequest({
        messages: [{ role: "user", content: "這份報價看起來如何？" }],
        workflowAction: "payment",
        orderId: "ORDER-1",
        quoteId: "QUOTE-1",
      }),
    WorkflowRequestError,
  );
  assert.throws(
    () =>
      parseWorkflowRequest({
        messages: [{ role: "user", content: "我不同意付款，請不要送出。" }],
        workflowAction: "payment",
        orderId: "ORDER-1",
        quoteId: "QUOTE-1",
      }),
    WorkflowRequestError,
  );
});

test("rejects unknown actions and oversized conversations", () => {
  assert.throws(
    () =>
      parseWorkflowRequest({
        messages: [{ role: "user", content: "hello" }],
        workflowAction: "admin_override",
      }),
    /workflowAction 不受支援/,
  );
  assert.throws(
    () =>
      parseWorkflowRequest({
        messages: [{ role: "user", content: "x".repeat(8_001) }],
      }),
    /不可超過 8000 字元/,
  );
});
