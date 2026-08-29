import { decodePaymentResponseHeader } from "@x402/fetch";
import type { AgentPolicy, CustomsBrokerReceipt, CustomsBrokerResponse, CustomsQuoteResponse, DutyQuote, ExportDocuments } from "./domain.js";
import { getMockExportDocuments } from "./mock-exporter.js";
import { log } from "./logger.js";
import { assertPaymentAllowed } from "./payment/policy.js";

export interface QuoteResult {
  orderId: string;
  documents: ExportDocuments;
  quote: DutyQuote;
  audit: string[];
}

export interface SubmissionResult extends QuoteResult {
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
    private readonly importerAddress: string
  ) {}

  async getQuote(orderId: string): Promise<QuoteResult> {
    const audit: string[] = [];
    log("info", "importer-agent", "quote.started", { orderId });
    const documents = getMockExportDocuments(orderId);
    audit.push(`Fetched export documents for ${documents.invoiceNumber}`);
    this.validateDocuments(documents);
    audit.push("Validated required trade document fields");
    const response = await this.fetch(`${this.customsBrokerApiUrl}/customs/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(documents)
    });
    if (!response.ok) {
      throw new Error(`Customs quote failed: ${response.status} ${await response.text()}`);
    }
    const { quote } = (await response.json()) as CustomsQuoteResponse;
    audit.push(`Received quote ${quote.quoteId}; no payment was made`);
    log("info", "importer-agent", "quote.completed", {
      orderId,
      quoteId: quote.quoteId,
      totalEstimatedUsd: quote.totalEstimatedUsd,
      brokerFeeUsd: quote.customsBrokerFeeUsd
    });
    return { orderId, documents, quote, audit };
  }

  async submit(orderId: string, quoteId: string, humanApproved = false): Promise<SubmissionResult> {
    const audit: string[] = [];
    log("info", "importer-agent", "submission.started", { orderId, quoteId, humanApproved });
    const documents = getMockExportDocuments(orderId);
    this.validateDocuments(documents);
    assertPaymentAllowed(this.policy, this.brokerFeeUsd, this.brokerAddress, humanApproved);
    audit.push("Payment request passed importer policy checks");
    log("info", "importer-agent", "payment.approved", {
      orderId,
      quoteId,
      amount: this.brokerFeeUsd,
      importerAddress: this.importerAddress,
      brokerAddress: this.brokerAddress
    });
    const paidResponse = await this.paidFetch(`${this.customsBrokerApiUrl}/customs/declarations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteId, documents })
    });
    if (!paidResponse.ok) {
      throw new Error(`Customs broker payment failed: ${paidResponse.status} ${await paidResponse.text()}`);
    }
    const result = (await paidResponse.json()) as CustomsBrokerResponse;
    const paymentResponse = paidResponse.headers.get("payment-response");
    const settlement = paymentResponse ? decodePaymentResponseHeader(paymentResponse) : undefined;
    audit.push(`Paid customs broker and received receipt ${result.receipt.receiptId}`);
    log("info", "importer-agent", "submission.completed", {
      orderId,
      quoteId,
      declarationId: result.receipt.declarationId,
      receiptId: result.receipt.receiptId,
      brokerFeeUsd: result.receipt.brokerFeeUsd,
      settlement
    });
    return { orderId, documents, quote: result.quote, receipt: result.receipt, settlement, audit };
  }

  private validateDocuments(documents: ExportDocuments) {
    if (!documents.invoiceNumber || !documents.exporter || !documents.importer) {
      throw new Error("Trade documents are missing required parties or invoice number");
    }
    if (!documents.items.length) throw new Error("Trade documents contain no items");
    if (documents.items.some(item => !item.hsCode)) {
      throw new Error("Every item must have an HS code before customs filing");
    }
  }
}
