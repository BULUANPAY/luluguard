import { randomUUID } from "node:crypto";
import { decodePaymentResponseHeader } from "@x402/fetch";
import type {
  AgentPolicy,
  CustomsBrokerReceipt,
  CustomsBrokerResponse,
  CustomsQuoteResponse,
  DutyQuote,
  ExportDocuments,
} from "./domain.js";
import { log } from "./logger.js";
import {
  assertPaymentAllowed,
  PaymentPolicyError,
  type PaymentPolicyDecision,
  type PaymentRecord,
} from "./payment/policy.js";
import {
  reviewImportQuote,
  type ComplianceReview,
} from "./compliance-review.js";
import {
  reviewDocumentsBeforeTransmission,
  type DocumentReview,
} from "./document-review.js";
import { estimateImportCosts, type ImportEstimate } from "./import-estimate.js";
import { newAuditId, writeAudit, type AuditStatus } from "./audit.js";
import type { VerifiedAgentAuthorization } from "./vlei-authorization.js";

export interface PreflightResult {
  preflightId: string;
  orderId: string;
  documents: ExportDocuments;
  documentReview: DocumentReview;
  independentEstimate?: ImportEstimate;
  readyForBroker: boolean;
  transmittedToBroker: false;
  audit: string[];
}

export interface QuoteResult {
  preflightId: string;
  orderId: string;
  documents: ExportDocuments;
  documentReview: DocumentReview;
  independentEstimate: ImportEstimate;
  estimateApproved: true;
  transmittedToBroker: true;
  quote: DutyQuote;
  complianceReview: ComplianceReview;
  audit: string[];
}

export interface SubmissionResult extends QuoteResult {
  paymentPolicyDecision: PaymentPolicyDecision;
  receipt: CustomsBrokerReceipt;
  settlement?: unknown;
}

export class ImporterAgent {
  constructor(
    private readonly customsBrokerApiUrl: string,
    private readonly policy: AgentPolicy,
    private readonly fetch: typeof globalThis.fetch,
    private readonly paidFetch: typeof globalThis.fetch,
    private readonly brokerFeeUsd: number,
    private readonly brokerAddress: string,
    private readonly importerAddress: string,
    private readonly preflightStore = new Map<string, PreflightResult>(),
    private readonly quoteStore = new Map<string, QuoteResult>(),
    private readonly paymentHistory: PaymentRecord[] = [],
    private readonly traceId = newAuditId("TRACE"),
    private readonly identity?: VerifiedAgentAuthorization,
  ) {}

  private audit(
    action: string,
    status: AuditStatus,
    data?: unknown,
    spanId?: string,
  ) {
    writeAudit({
      traceId: this.traceId,
      spanId,
      component: "importer-agent",
      action,
      status,
      actor: this.identity?.userId ?? "importer-agent",
      tenantId: this.identity?.tenantId,
      userId: this.identity?.userId,
      sessionId: this.identity?.sessionId,
      agentId: "luluguard-importer-agent",
      agentRunId: this.identity?.agentRunId,
      data,
    });
  }

  precheck(orderId: string, documents: ExportDocuments): PreflightResult {
    const audit: string[] = [];
    const preflightId = `PREFLIGHT-${randomUUID()}`;
    this.audit(
      "preflight.review",
      "attempted",
      { orderId, providedDocuments: documents.providedDocuments },
      preflightId,
    );
    log("info", "importer-agent", "preflight.started", {
      orderId,
      providedDocuments: documents.providedDocuments,
    });
    audit.push("Loaded export documents from the order's uploaded files");
    const documentReview = reviewDocumentsBeforeTransmission(documents);
    audit.push(
      `Document review completed; readyToTransmit=${documentReview.readyToTransmit}`,
    );
    const independentEstimate = documentReview.readyToTransmit
      ? estimateImportCosts(documents, this.brokerFeeUsd)
      : undefined;
    if (independentEstimate)
      audit.push(
        "Generated independent importer estimate; broker was not contacted",
      );
    const result: PreflightResult = {
      preflightId,
      orderId,
      documents,
      documentReview,
      independentEstimate,
      readyForBroker: documentReview.readyToTransmit,
      transmittedToBroker: false,
      audit,
    };
    this.preflightStore.set(preflightId, result);
    this.audit(
      "preflight.review",
      "succeeded",
      { input: { orderId, providedDocuments: documents.providedDocuments }, result },
      preflightId,
    );
    log(
      documentReview.readyToTransmit ? "info" : "warn",
      "importer-agent",
      "preflight.completed",
      {
        orderId,
        preflightId,
        readyForBroker: result.readyForBroker,
        estimatedTotalUsd: independentEstimate?.estimatedTotalUsd,
        transmittedToBroker: false,
      },
    );
    return result;
  }

  async getQuote(
    preflightId: string,
    estimateApproved: boolean,
  ): Promise<QuoteResult> {
    this.audit(
      "broker-quote.prepare",
      "attempted",
      { preflightId, estimateApproved },
      preflightId,
    );
    const preflight = this.preflightStore.get(preflightId);
    if (!preflight) {
      this.audit(
        "broker-quote.prepare",
        "blocked",
        { preflightId, reason: "PREFLIGHT_NOT_FOUND" },
        preflightId,
      );
      throw new Error(
        "A valid importer preflight is required before broker quotation",
      );
    }
    if (!preflight.readyForBroker || !preflight.independentEstimate) {
      this.audit(
        "broker-quote.prepare",
        "blocked",
        { preflightId, reason: "DOCUMENT_REVIEW_NOT_READY", preflight },
        preflightId,
      );
      throw new Error("Document review must pass before broker quotation");
    }
    if (!estimateApproved) {
      this.audit(
        "broker-quote.prepare",
        "blocked",
        { preflightId, reason: "ESTIMATE_NOT_APPROVED" },
        preflightId,
      );
      throw new Error(
        "The user must confirm the independent estimate before documents are sent to the broker",
      );
    }
    const { orderId, documents, documentReview, independentEstimate } =
      preflight;
    this.validateDocuments(documents);
    const audit = [
      ...preflight.audit,
      "User confirmed the independent estimate",
    ];
    log("info", "importer-agent", "broker_quote.started", {
      orderId,
      preflightId,
    });
    const brokerUrl = `${this.customsBrokerApiUrl}/customs/quotes`;
    this.audit(
      "broker.http.request",
      "attempted",
      { method: "POST", url: brokerUrl, body: documents },
      preflightId,
    );
    let response: Response;
    try {
      response = await this.fetch(brokerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-audit-trace-id": this.traceId,
        },
        body: JSON.stringify(documents),
      });
    } catch (error) {
      this.audit(
        "broker.http.request",
        "failed",
        { method: "POST", url: brokerUrl, error },
        preflightId,
      );
      throw error;
    }
    if (!response.ok) {
      const responseText = await response.text();
      this.audit(
        "broker.http.response",
        "failed",
        { url: brokerUrl, status: response.status, body: responseText },
        preflightId,
      );
      throw new Error(
        `Customs quote failed: ${response.status} ${responseText}`,
      );
    }
    const { quote } = (await response.json()) as CustomsQuoteResponse;
    this.audit(
      "broker.http.response",
      "succeeded",
      { url: brokerUrl, status: response.status, body: { quote } },
      preflightId,
    );
    const complianceReview = reviewImportQuote(
      documents,
      quote,
      this.brokerFeeUsd,
    );
    audit.push(
      `Received broker quote ${quote.quoteId} and compared it with the independent estimate`,
    );
    const result: QuoteResult = {
      preflightId,
      orderId,
      documents,
      documentReview,
      independentEstimate,
      estimateApproved: true,
      transmittedToBroker: true,
      quote,
      complianceReview,
      audit,
    };
    this.quoteStore.set(quote.quoteId, result);
    this.audit("broker-quote.review", "succeeded", { result }, preflightId);
    log("info", "importer-agent", "broker_quote.completed", {
      orderId,
      preflightId,
      quoteId: quote.quoteId,
      independentEstimateUsd: independentEstimate.estimatedTotalUsd,
      brokerEstimateUsd: quote.totalEstimatedUsd,
      paymentAllowed: complianceReview.paymentAllowed,
    });
    return result;
  }

  async submit(
    orderId: string,
    quoteId: string,
    humanApproved = false,
  ): Promise<SubmissionResult> {
    const audit: string[] = [];
    const paymentAttemptId = `ATTEMPT-${randomUUID()}`;
    this.audit(
      "payment.submit",
      "attempted",
      { orderId, quoteId, humanApproved },
      paymentAttemptId,
    );
    log("info", "payment-audit", "payment.attempted", {
      paymentAttemptId,
      orderId,
      quoteId,
      humanApproved,
    });
    const reviewedQuote = this.quoteStore.get(quoteId);
    if (!reviewedQuote || reviewedQuote.orderId !== orderId) {
      this.audit(
        "payment.submit",
        "blocked",
        { orderId, quoteId, reason: "REVIEWED_QUOTE_NOT_FOUND" },
        paymentAttemptId,
      );
      log("warn", "payment-audit", "payment.precondition_blocked", {
        paymentAttemptId,
        orderId,
        quoteId,
        reasonCode: "REVIEWED_QUOTE_NOT_FOUND",
      });
      throw new Error(
        "A matching reviewed broker quote is required before payment",
      );
    }
    if (!reviewedQuote.complianceReview.paymentAllowed) {
      this.audit(
        "payment.submit",
        "blocked",
        {
          orderId,
          quoteId,
          reason: "COMPLIANCE_REVIEW_BLOCKED",
          complianceReview: reviewedQuote.complianceReview,
        },
        paymentAttemptId,
      );
      log("warn", "payment-audit", "payment.precondition_blocked", {
        paymentAttemptId,
        orderId,
        quoteId,
        reasonCode: "COMPLIANCE_REVIEW_BLOCKED",
      });
      throw new Error(
        "Broker quote comparison blocked payment; resolve blocker findings before filing",
      );
    }
    if (Date.parse(reviewedQuote.quote.expiresAt) <= Date.now()) {
      this.audit(
        "payment.submit",
        "blocked",
        {
          orderId,
          quoteId,
          reason: "QUOTE_EXPIRED",
          expiresAt: reviewedQuote.quote.expiresAt,
        },
        paymentAttemptId,
      );
      log("warn", "payment-audit", "payment.precondition_blocked", {
        paymentAttemptId,
        orderId,
        quoteId,
        reasonCode: "QUOTE_EXPIRED",
        expiresAt: reviewedQuote.quote.expiresAt,
      });
      throw new Error("Broker quote expired before payment");
    }
    const { documents } = reviewedQuote;
    this.validateDocuments(documents);
    log("info", "payment-audit", "policy.evaluation.started", {
      paymentAttemptId,
      orderId,
      quoteId,
      amountUsdc: this.brokerFeeUsd,
      payee: this.brokerAddress,
      humanApproved,
    });
    let paymentPolicyDecision: PaymentPolicyDecision;
    try {
      paymentPolicyDecision = assertPaymentAllowed(
        this.policy,
        this.brokerFeeUsd,
        this.brokerAddress,
        humanApproved,
        this.paymentHistory,
      );
    } catch (error) {
      if (error instanceof PaymentPolicyError) {
        log("warn", "payment-audit", "policy.evaluation.blocked", {
          paymentAttemptId,
          orderId,
          quoteId,
          ...error.decision,
        });
      }
      this.audit(
        "payment.policy-evaluation",
        "blocked",
        { orderId, quoteId, error },
        paymentAttemptId,
      );
      throw error;
    }
    this.audit(
      "payment.policy-evaluation",
      "succeeded",
      { orderId, quoteId, decision: paymentPolicyDecision },
      paymentAttemptId,
    );
    audit.push(
      `Payment policy approved; auditId=${paymentPolicyDecision.auditId}`,
    );
    log("info", "payment-audit", "policy.evaluation.allowed", {
      orderId,
      quoteId,
      paymentAttemptId,
      ...paymentPolicyDecision,
      importerAddress: this.importerAddress,
      brokerAddress: this.brokerAddress,
      networkAction: "x402-payment",
    });
    log("info", "payment-audit", "payment.dispatched", {
      paymentAttemptId,
      auditId: paymentPolicyDecision.auditId,
      orderId,
      quoteId,
      amountUsdc: this.brokerFeeUsd,
    });
    let paidResponse: Response;
    const declarationUrl = `${this.customsBrokerApiUrl}/customs/declarations`;
    this.audit(
      "broker.paid-http.request",
      "attempted",
      {
        method: "POST",
        url: declarationUrl,
        body: { quoteId, documents },
        paymentPolicyDecision,
      },
      paymentAttemptId,
    );
    try {
      paidResponse = await this.paidFetch(declarationUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-audit-trace-id": this.traceId,
        },
        body: JSON.stringify({ quoteId, documents }),
      });
    } catch (error) {
      log("error", "payment-audit", "payment.transport_failed", {
        auditId: paymentPolicyDecision.auditId,
        paymentAttemptId,
        orderId,
        quoteId,
        message: error instanceof Error ? error.message : String(error),
      });
      this.audit(
        "broker.paid-http.request",
        "failed",
        { method: "POST", url: declarationUrl, error },
        paymentAttemptId,
      );
      throw error;
    }
    if (!paidResponse.ok) {
      const responseText = await paidResponse.text();
      log("error", "payment-audit", "payment.rejected", {
        paymentAttemptId,
        auditId: paymentPolicyDecision.auditId,
        orderId,
        quoteId,
        status: paidResponse.status,
      });
      this.audit(
        "broker.paid-http.response",
        "failed",
        {
          url: declarationUrl,
          status: paidResponse.status,
          body: responseText,
        },
        paymentAttemptId,
      );
      throw new Error(
        `Customs broker payment failed: ${paidResponse.status} ${responseText}`,
      );
    }
    const response = (await paidResponse.json()) as CustomsBrokerResponse;
    const paymentResponse = paidResponse.headers.get("payment-response");
    const settlement = paymentResponse
      ? decodePaymentResponseHeader(paymentResponse)
      : undefined;
    this.audit(
      "broker.paid-http.response",
      "succeeded",
      {
        url: declarationUrl,
        status: paidResponse.status,
        body: response,
        paymentResponse,
        settlement,
      },
      paymentAttemptId,
    );
    this.paymentHistory.push({
      timestamp: response.receipt.timestamp,
      amountUsdc: response.receipt.brokerFeeUsd,
      payee: response.receipt.brokerAddress,
      quoteId,
      receiptId: response.receipt.receiptId,
    });
    this.quoteStore.delete(quoteId);
    log("info", "payment-audit", "payment.succeeded", {
      auditId: paymentPolicyDecision.auditId,
      paymentAttemptId,
      orderId,
      quoteId,
      receiptId: response.receipt.receiptId,
      amountUsdc: response.receipt.brokerFeeUsd,
      payee: response.receipt.brokerAddress,
      settlementRecorded: Boolean(settlement),
    });
    audit.push(
      `Paid customs broker and received receipt ${response.receipt.receiptId}`,
    );
    const result = {
      ...reviewedQuote,
      quote: response.quote,
      complianceReview: reviewImportQuote(
        documents,
        response.quote,
        this.brokerFeeUsd,
      ),
      paymentPolicyDecision,
      receipt: response.receipt,
      settlement,
      audit: [...reviewedQuote.audit, ...audit],
    };
    this.audit(
      "payment.submit",
      "succeeded",
      { orderId, quoteId, result },
      paymentAttemptId,
    );
    return result;
  }

  private validateDocuments(documents: ExportDocuments) {
    if (
      !documents.invoiceNumber ||
      !documents.exporter ||
      !documents.importer
    ) {
      throw new Error(
        "Trade documents are missing required parties or invoice number",
      );
    }
    if (!documents.items.length)
      throw new Error("Trade documents contain no items");
    if (documents.items.some((item) => !item.hsCode)) {
      throw new Error("Every item must have an HS code before customs filing");
    }
  }
}
