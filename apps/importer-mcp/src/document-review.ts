import type { ExportDocuments, TradeDocumentType } from "./domain.js";
import type { ReviewFinding } from "./compliance-review.js";

export interface DocumentReview {
  readyToTransmit: boolean;
  reviewedAt: string;
  selectedDocuments: TradeDocumentType[];
  missingRequiredDocuments: TradeDocumentType[];
  findings: ReviewFinding[];
}

const requiredDocuments: TradeDocumentType[] = [
  "commercial_invoice",
  "packing_list",
  "bill_of_lading"
];

export function reviewDocumentsBeforeTransmission(documents: ExportDocuments): DocumentReview {
  const selected = new Set(documents.providedDocuments);
  const missingRequiredDocuments = requiredDocuments.filter(type => !selected.has(type));
  const findings: ReviewFinding[] = missingRequiredDocuments.map(type => ({
    code: `MISSING_${type.toUpperCase()}`,
    severity: "blocker",
    message: `Required document is missing: ${type}.`
  }));

  if (selected.has("commercial_invoice") && (
    !documents.invoiceNumber ||
    !documents.invoiceDate ||
    !documents.exporter ||
    !documents.importer ||
    !documents.incoterm ||
    documents.freightUsd === undefined ||
    documents.insuranceUsd === undefined ||
    !documents.items.length
  )) {
    findings.push({
      code: "COMMERCIAL_INVOICE_INCOMPLETE",
      severity: "blocker",
      message: "Commercial invoice data is incomplete."
    });
  }
  if (selected.has("packing_list") && (
    !documents.packageCount ||
    !documents.grossWeightKg ||
    !documents.netWeightKg
  )) {
    findings.push({
      code: "PACKING_LIST_INCOMPLETE",
      severity: "blocker",
      message: "Packing list must include package count and gross/net weight."
    });
  }
  if (selected.has("bill_of_lading") && !documents.billOfLadingNumber) {
    findings.push({
      code: "BILL_OF_LADING_INCOMPLETE",
      severity: "blocker",
      message: "Bill of lading number is missing."
    });
  }
  if (!selected.has("certificate_of_origin")) {
    findings.push({
      code: "CERTIFICATE_OF_ORIGIN_NOT_SELECTED",
      severity: "warning",
      message: "Origin evidence was not selected; preferential tariff eligibility cannot be assessed."
    });
  }
  if (!selected.has("product_specification")) {
    findings.push({
      code: "PRODUCT_SPECIFICATION_NOT_SELECTED",
      severity: "warning",
      message: "Product specification was not selected; tariff classification may require more detail."
    });
  }
  if (!selected.has("import_permit")) {
    findings.push({
      code: "IMPORT_PERMIT_NOT_SELECTED",
      severity: "warning",
      message: "No import permit was selected. Confirm whether the official import regulations require one."
    });
  }

  return {
    readyToTransmit: !findings.some(finding => finding.severity === "blocker"),
    reviewedAt: new Date().toISOString(),
    selectedDocuments: documents.providedDocuments,
    missingRequiredDocuments,
    findings
  };
}
