import { REQUIRED_TRADE_DOCUMENT_TYPES } from "@luluguard/shared";
import type { ExportDocuments, TradeDocumentType } from "./domain.js";
import type { ReviewFinding } from "./compliance-review.js";

export interface DocumentReview {
  readyToTransmit: boolean;
  reviewedAt: string;
  selectedDocuments: TradeDocumentType[];
  missingRequiredDocuments: TradeDocumentType[];
  lowCarbonAssessment: LowCarbonAssessment;
  findings: ReviewFinding[];
}

export interface LowCarbonAssessment {
  dppId?: string;
  documentValid: boolean;
  qualifiesAsLowCarbonProduct: boolean;
  calculatedReductionPercent?: number;
  minimumReductionPercent: number;
  basis: "importer-demo-policy";
}

export const LOW_CARBON_REDUCTION_THRESHOLD_PERCENT = 20;

const requiredDocuments: TradeDocumentType[] =
  REQUIRED_TRADE_DOCUMENT_TYPES.filter(
    (documentType) => documentType !== "power_of_attorney",
  );

function isPositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function isNonNegative(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

export function reviewDocumentsBeforeTransmission(
  documents: ExportDocuments,
  now = new Date(),
): DocumentReview {
  const selected = new Set(documents.providedDocuments);
  const missingRequiredDocuments = requiredDocuments.filter(
    (type) => !selected.has(type),
  );
  const findings: ReviewFinding[] = missingRequiredDocuments.map((type) => ({
    code: `MISSING_${type.toUpperCase()}`,
    severity: "blocker",
    message: `Required document is missing: ${type}.`,
  }));

  if (
    selected.has("commercial_invoice") &&
    (!documents.invoiceNumber ||
      !documents.invoiceDate ||
      !documents.exporter ||
      !documents.importer ||
      !documents.incoterm ||
      !isNonNegative(documents.freightUsd) ||
      !isNonNegative(documents.insuranceUsd) ||
      !documents.items.length ||
      documents.items.some(
        (item) =>
          !isPositive(item.quantity) || !isNonNegative(item.unitPriceUsd),
      ))
  ) {
    findings.push({
      code: "COMMERCIAL_INVOICE_INCOMPLETE",
      severity: "blocker",
      message:
        "Commercial invoice data is incomplete or contains invalid numeric values.",
    });
  }
  if (
    selected.has("packing_list") &&
    (!isPositive(documents.packageCount) ||
      !isPositive(documents.grossWeightKg) ||
      !isPositive(documents.netWeightKg) ||
      documents.grossWeightKg < documents.netWeightKg)
  ) {
    findings.push({
      code: "PACKING_LIST_INCOMPLETE",
      severity: "blocker",
      message:
        "Packing list must include valid package count and gross/net weight values.",
    });
  }
  if (selected.has("bill_of_lading") && !documents.billOfLadingNumber) {
    findings.push({
      code: "BILL_OF_LADING_INCOMPLETE",
      severity: "blocker",
      message: "Bill of lading number is missing.",
    });
  }
  const lowCarbonAssessment = reviewDigitalProductPassport(
    documents,
    now,
    findings,
  );
  if (!selected.has("certificate_of_origin")) {
    findings.push({
      code: "CERTIFICATE_OF_ORIGIN_NOT_SELECTED",
      severity: "warning",
      message:
        "Origin evidence was not selected; preferential tariff eligibility cannot be assessed.",
    });
  }
  if (!selected.has("bill_of_lading")) {
    findings.push({
      code: "BILL_OF_LADING_NOT_SELECTED",
      severity: "warning",
      message:
        "Bill of lading was not selected; shipment and carrier details cannot be verified.",
    });
  }
  if (!selected.has("digital_product_passport")) {
    findings.push({
      code: "DIGITAL_PRODUCT_PASSPORT_NOT_SELECTED",
      severity: "warning",
      message:
        "Digital product passport was not selected; low-carbon qualification cannot be assessed.",
    });
  }
  if (!selected.has("product_specification")) {
    findings.push({
      code: "PRODUCT_SPECIFICATION_NOT_SELECTED",
      severity: "warning",
      message:
        "Product specification was not selected; tariff classification may require more detail.",
    });
  }
  if (!selected.has("import_permit")) {
    findings.push({
      code: "IMPORT_PERMIT_NOT_SELECTED",
      severity: "warning",
      message:
        "No import permit was selected. Confirm whether the official import regulations require one.",
    });
  }

  return {
    readyToTransmit: !findings.some(
      (finding) => finding.severity === "blocker",
    ),
    reviewedAt: now.toISOString(),
    selectedDocuments: documents.providedDocuments,
    missingRequiredDocuments,
    lowCarbonAssessment,
    findings,
  };
}

function reviewDigitalProductPassport(
  documents: ExportDocuments,
  now: Date,
  findings: ReviewFinding[],
): LowCarbonAssessment {
  const dpp = documents.digitalProductPassport;
  const assessment: LowCarbonAssessment = {
    dppId: dpp?.dppId,
    documentValid: false,
    qualifiesAsLowCarbonProduct: false,
    minimumReductionPercent: LOW_CARBON_REDUCTION_THRESHOLD_PERCENT,
    basis: "importer-demo-policy",
  };
  if (!dpp) {
    if (documents.providedDocuments.includes("digital_product_passport")) {
      findings.push({
        code: "DIGITAL_PRODUCT_PASSPORT_INCOMPLETE",
        severity: "blocker",
        message: "The provided DPP could not be parsed.",
      });
    }
    return assessment;
  }

  const footprint = dpp.carbonFootprint.productCarbonFootprintKgCo2e;
  const baseline = dpp.carbonFootprint.baselineKgCo2e;
  const claimedReduction = dpp.carbonFootprint.claimedReductionPercent;
  const calculatedReduction =
    Number.isFinite(footprint) && Number.isFinite(baseline) && baseline > 0
      ? Math.round(((baseline - footprint) / baseline) * 100 * 100) / 100
      : undefined;
  assessment.calculatedReductionPercent = calculatedReduction;

  const dates = [
    Date.parse(dpp.carbonFootprint.verifiedAt),
    Date.parse(dpp.validity.validFrom),
    Date.parse(dpp.validity.validUntil),
  ];
  const structurallyComplete = Boolean(
    dpp.documentId &&
    dpp.dppId &&
    dpp.product.name &&
    dpp.product.model &&
    dpp.product.hsCode &&
    dpp.product.batchId &&
    dpp.product.quantity > 0 &&
    dpp.product.unit &&
    Number.isFinite(footprint) &&
    footprint >= 0 &&
    Number.isFinite(baseline) &&
    baseline > 0 &&
    Number.isFinite(claimedReduction) &&
    claimedReduction >= 0 &&
    claimedReduction <= 100 &&
    dpp.carbonFootprint.methodology &&
    dpp.carbonFootprint.systemBoundary &&
    dpp.carbonFootprint.verificationStandard &&
    dpp.carbonFootprint.verifiedBy &&
    dates.every(Number.isFinite),
  );
  if (!structurallyComplete) {
    findings.push({
      code: "DIGITAL_PRODUCT_PASSPORT_INCOMPLETE",
      severity: "blocker",
      message:
        "DPP is incomplete or contains invalid product, carbon-footprint, verification, or validity data.",
    });
    return assessment;
  }

  const [verifiedAt, validFrom, validUntil] = dates as [number, number, number];
  if (
    verifiedAt > now.getTime() ||
    validFrom > now.getTime() ||
    validUntil < now.getTime() ||
    validUntil < validFrom
  ) {
    findings.push({
      code: "DIGITAL_PRODUCT_PASSPORT_NOT_VALID",
      severity: "blocker",
      message:
        "DPP verification and validity dates are not valid for the customs filing date.",
    });
    return assessment;
  }

  if (
    calculatedReduction === undefined ||
    Math.abs(calculatedReduction - claimedReduction) > 0.1
  ) {
    findings.push({
      code: "DPP_CARBON_REDUCTION_MISMATCH",
      severity: "blocker",
      message:
        "DPP claimed carbon reduction does not match the footprint and baseline values.",
    });
    return assessment;
  }

  const matchingItem = documents.items.find(
    (item) =>
      item.description === dpp.product.name &&
      item.model === dpp.product.model &&
      item.hsCode === dpp.product.hsCode &&
      item.quantity === dpp.product.quantity &&
      (!item.dppBatchId || item.dppBatchId === dpp.product.batchId),
  );
  if (!matchingItem) {
    findings.push({
      code: "DPP_PRODUCT_MISMATCH",
      severity: "blocker",
      message:
        "DPP product identity, quantity, HS code, or batch does not match the commercial invoice.",
    });
    return assessment;
  }

  assessment.documentValid = true;
  assessment.qualifiesAsLowCarbonProduct =
    calculatedReduction >= LOW_CARBON_REDUCTION_THRESHOLD_PERCENT;
  if (!assessment.qualifiesAsLowCarbonProduct) {
    findings.push({
      code: "LOW_CARBON_THRESHOLD_NOT_MET",
      severity: "warning",
      message: `Verified reduction is below the importer demo-policy threshold of ${LOW_CARBON_REDUCTION_THRESHOLD_PERCENT}%.`,
    });
  }
  return assessment;
}
