import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ExportDocumentsSchema,
  QuoteRequestSchema,
  SettlementDetailsSchema,
  parseSettlementDetails,
  type ExportDocuments
} from "../src/domain.js";
import { canonicalizeDocuments, hashDocuments } from "../src/document-hash.js";
import { calculateMockQuote } from "../src/quote-calculator.js";
import {
  QuoteStore,
  QuoteStoreError,
  type SettlementExpectation
} from "../src/quote-store.js";

const NETWORK = "eip155:84532";
const BROKER_ADDRESS = "0x1111111111111111111111111111111111111111";
const PAYER_ADDRESS = "0x2222222222222222222222222222222222222222";
const TRANSACTION = `0x${"a".repeat(64)}`;
const EXPECTED: SettlementExpectation = {
  expectedNetwork: NETWORK,
  expectedAmount: "10000"
};

const documents: ExportDocuments = {
  invoiceNumber: "INV-CORE-001",
  invoiceDate: "2026-08-29",
  exporter: "Exporter Ltd",
  importer: "Importer Ltd",
  originCountry: "US",
  destinationCountry: "TW",
  currency: "USD",
  incoterm: "CIF",
  freightUsd: 1.11,
  insuranceUsd: 0.22,
  packageCount: 2,
  grossWeightKg: 3.5,
  netWeightKg: 3.2,
  billOfLadingNumber: "BL-001",
  certificateOfOriginNumber: "COO-001",
  importPermitNumber: "PERMIT-001",
  powerOfAttorney: {
    documentType: "power_of_attorney",
    documentId: "LOA-CORE-001",
    version: "1.0",
    orderId: "ORDER-CORE-001",
    acceptedAt: "2026-08-29T00:00:00.000Z",
    importer: { name: "Importer Ltd", lei: "549300CORETEST000001" },
    representative: {
      employeeId: "EMP-CORE-001",
      name: "Test Importer",
      role: "Import Operations Manager"
    },
    scope: ["Transmit order documents for customs quotation"],
    vleiAuthorization: {
      authorizationId: "AUTH-CORE-001",
      signerAid: "ECoreSignerAid",
      signerCredentialSaid: "ECoreCredentialSaid"
    }
  },
  providedDocuments: ["commercial_invoice", "packing_list", "power_of_attorney"],
  items: [{
    description: "Widget",
    model: "W-1",
    material: "Steel",
    intendedUse: "Testing",
    quantity: 2,
    unitPriceUsd: 12.34,
    hsCode: "84713000"
  }]
};
const documentItem = documents.items[0]!;

const successfulSettlement = {
  success: true,
  transaction: TRANSACTION,
  network: NETWORK,
  payer: PAYER_ADDRESS,
  amount: "10000"
};

function createStore(start = "2026-08-29T00:00:00.000Z") {
  let current = new Date(start);
  const store = new QuoteStore({ clock: () => new Date(current.getTime()) });
  return {
    store,
    advance(milliseconds: number) {
      current = new Date(current.getTime() + milliseconds);
    },
    save(expiresInSeconds = 300) {
      return store.save(
        calculateMockQuote(documents, {
          now: current,
          quoteId: `QUOTE-${Date.now()}-${Math.random()}`,
          declarationId: "DECL-CORE",
          quoteTtlSeconds: expiresInSeconds
        }),
        documents
      );
    }
  };
}

function expectStoreError(code: QuoteStoreError["code"], callback: () => unknown) {
  assert.throws(callback, (error: unknown) =>
    error instanceof QuoteStoreError && error.code === code
  );
}

test("validates money precision, integer quantities, and item-value overflow", () => {
  assert.equal(ExportDocumentsSchema.safeParse(documents).success, true);
  assert.equal(ExportDocumentsSchema.safeParse({
    ...documents,
    freightUsd: 1.001
  }).success, false);
  assert.equal(ExportDocumentsSchema.safeParse({
    ...documents,
    items: [{ ...documentItem, quantity: 1.5 }]
  }).success, false);
  assert.equal(ExportDocumentsSchema.safeParse({
    ...documents,
    packageCount: 1.5
  }).success, false);
  assert.equal(ExportDocumentsSchema.safeParse({
    ...documents,
    items: [{ ...documentItem, quantity: 1_000_000, unitPriceUsd: 1_000_000_000 }]
  }).success, false);
});

test("validates required document types, cross-field data, uniqueness, and strict objects", () => {
  const completeDocuments = {
    ...documents,
    billOfLadingNumber: "BL-CORE-001",
    providedDocuments: [
      "commercial_invoice",
      "packing_list",
      "bill_of_lading",
      "power_of_attorney"
    ] as const
  };
  assert.equal(QuoteRequestSchema.safeParse(completeDocuments).success, true);
  assert.equal(QuoteRequestSchema.safeParse({
    ...completeDocuments,
    powerOfAttorney: undefined
  }).success, false);
  assert.equal(QuoteRequestSchema.safeParse({
    ...completeDocuments,
    providedDocuments: ["commercial_invoice", "packing_list"]
  }).success, false);
  assert.equal(QuoteRequestSchema.safeParse({
    ...completeDocuments,
    billOfLadingNumber: undefined,
    providedDocuments: ["commercial_invoice", "packing_list", "power_of_attorney"]
  }).success, true);
  assert.equal(QuoteRequestSchema.safeParse({
    ...completeDocuments,
    providedDocuments: [
      "commercial_invoice",
      "packing_list",
      "digital_product_passport",
      "power_of_attorney"
    ]
  }).success, true);
  assert.equal(QuoteRequestSchema.safeParse({
    ...completeDocuments,
    providedDocuments: [
      "commercial_invoice",
      "packing_list",
      "packing_list",
      "power_of_attorney"
    ]
  }).success, false);
  assert.equal(QuoteRequestSchema.safeParse({
    ...completeDocuments,
    freightUsd: undefined
  }).success, false);
  assert.equal(QuoteRequestSchema.safeParse({
    ...completeDocuments,
    billOfLadingNumber: undefined
  }).success, false);
  assert.equal(QuoteRequestSchema.safeParse({
    ...completeDocuments,
    unexpectedField: true
  }).success, false);
  assert.equal(QuoteRequestSchema.safeParse({
    ...completeDocuments,
    netWeightKg: 20,
    grossWeightKg: 18
  }).success, false);
});

test("calculates monetary fields to cents and rejects unsupported totals", () => {
  const result = calculateMockQuote(documents, {
    now: new Date("2026-08-29T00:00:00.000Z"),
    quoteId: "QUOTE-CALC",
    declarationId: "DECL-CALC"
  });
  assert.equal(result.goodsValueUsd, 24.68);
  assert.equal(result.customsValueUsd, 26.01);
  assert.equal(result.dutyUsd, 0);
  assert.equal(result.taxUsd, 1.3);
  assert.equal(result.tradePromotionFeeUsd, 0.01);
  assert.equal(result.totalEstimatedUsd, 3.32);
  const microFeeResult = calculateMockQuote(documents, {
    now: new Date("2026-08-29T00:00:00.000Z"),
    brokerFeeUsd: 0.010001
  });
  assert.equal(microFeeResult.customsBrokerFeeUsd, 0.010001);
  assert.equal(microFeeResult.totalEstimatedUsd, 3.320001);
  for (const amount of [
    result.goodsValueUsd,
    result.freightUsd,
    result.insuranceUsd,
    result.customsValueUsd,
    result.dutyUsd,
    result.taxUsd,
    result.tradePromotionFeeUsd,
    result.filingFeeUsd,
    result.customsBrokerFeeUsd,
    result.totalEstimatedUsd
  ]) {
    assert.match(amount.toFixed(2), /^\d+\.\d{2}$/);
  }

  const oversizedDocuments = {
    ...documents,
    items: [
      { ...documentItem, unitPriceUsd: 1_000_000_000 },
      { ...documentItem, unitPriceUsd: 1_000_000_000 }
    ]
  };
  assert.throws(
    () => calculateMockQuote(oversizedDocuments, { now: new Date("2026-08-29T00:00:00.000Z") }),
    /safe supported range/
  );

  for (const quoteTtlSeconds of [0, -1, 1.5, 31_536_001]) {
    assert.throws(
      () => calculateMockQuote(documents, { quoteTtlSeconds }),
      /quoteTtlSeconds must be a positive integer no greater than one year/
    );
  }
});

test("canonical document hashing uses locale-independent key ordering", () => {
  const reordered = {
    items: documents.items,
    providedDocuments: documents.providedDocuments,
    destinationCountry: documents.destinationCountry,
    originCountry: documents.originCountry,
    importer: documents.importer,
    exporter: documents.exporter,
    invoiceNumber: documents.invoiceNumber,
    currency: documents.currency,
    freightUsd: documents.freightUsd,
    insuranceUsd: documents.insuranceUsd,
    invoiceDate: documents.invoiceDate,
    incoterm: documents.incoterm,
    packageCount: documents.packageCount,
    grossWeightKg: documents.grossWeightKg,
    netWeightKg: documents.netWeightKg,
    billOfLadingNumber: documents.billOfLadingNumber,
    certificateOfOriginNumber: documents.certificateOfOriginNumber,
    importPermitNumber: documents.importPermitNumber,
    powerOfAttorney: documents.powerOfAttorney
  } satisfies ExportDocuments;
  assert.equal(hashDocuments(documents), hashDocuments(reordered));
  assert.equal(
    hashDocuments(documents),
    hashDocuments({
      ...documents,
      providedDocuments: [...documents.providedDocuments].reverse()
    })
  );
  const canonical = canonicalizeDocuments(documents);
  assert.ok(canonical.indexOf("billOfLadingNumber") < canonical.indexOf("certificateOfOriginNumber"));
  assert.ok(canonical.indexOf("certificateOfOriginNumber") < canonical.indexOf("currency"));
  assert.ok(canonical.indexOf("currency") < canonical.indexOf("destinationCountry"));
});

test("parses and validates settlement details against the payment expectation", () => {
  assert.deepEqual(parseSettlementDetails(successfulSettlement, EXPECTED), successfulSettlement);
  assert.deepEqual(parseSettlementDetails({
    success: false,
    network: NETWORK,
    errorReason: "reverted"
  }, EXPECTED), {
    success: false,
    network: NETWORK,
    errorReason: "reverted"
  });
  assert.deepEqual(parseSettlementDetails({
    success: false,
    transaction: "",
    network: NETWORK,
    errorReason: "reverted"
  }, EXPECTED), {
    success: false,
    transaction: "",
    network: NETWORK,
    errorReason: "reverted"
  });

  for (const input of [
    { ...successfulSettlement, transaction: "0x1234" },
    { ...successfulSettlement, transaction: `0x${"g".repeat(64)}` },
    { ...successfulSettlement, transaction: `0x${"0".repeat(64)}` },
    { ...successfulSettlement, network: "eip155:1" },
    { ...successfulSettlement, amount: "10001" },
    { ...successfulSettlement, payer: "not-an-address" }
  ]) {
    assert.throws(() => parseSettlementDetails(input, EXPECTED));
  }
});

test("requires a live quote before begin and prepare, but allows in-flight settlement after expiry", () => {
  const { store, advance, save } = createStore();
  const record = save(1);
  const processing = store.beginProcessing(record.quote.quoteId, documents);
  assert.equal(processing.status, "PROCESSING");
  assert.ok(processing.attemptId);

  advance(1_001);
  expectStoreError("QUOTE_ALREADY_PROCESSING", () => store.beginProcessing(record.quote.quoteId, documents));
  expectStoreError("QUOTE_EXPIRED", () => store.prepareReceipt(
    record.quote.quoteId,
    processing.attemptId,
    BROKER_ADDRESS
  ));

  // A receipt prepared before expiry represents an in-flight settlement and
  // can still be finalized after the quote's wall-clock TTL.
  const second = createStore();
  const secondRecord = second.save(1);
  const secondProcessing = second.store.beginProcessing(secondRecord.quote.quoteId, documents);
  second.store.prepareReceipt(secondRecord.quote.quoteId, secondProcessing.attemptId, BROKER_ADDRESS);
  second.advance(1_001);
  const finished = second.store.finishSettlement(secondProcessing.attemptId, successfulSettlement, EXPECTED);
  assert.equal(finished.status, "FILED");
  assert.equal(finished.receipt?.status, "filed");
  second.advance(1_001);
  assert.equal(second.store.validateSubmission(secondRecord.quote.quoteId, documents).status, "FILED");
  expectStoreError("QUOTE_ALREADY_FILED", () => second.store.beginProcessing(
    secondRecord.quote.quoteId,
    documents
  ));
});

test("attempt tokens protect prepare, finish, and rollback from stale workers", () => {
  const { store, save } = createStore();
  const record = save();
  const first = store.beginProcessing(record.quote.quoteId, documents);
  expectStoreError("STALE_PROCESSING_ATTEMPT", () => store.prepareReceipt(
    record.quote.quoteId,
    "ATTEMPT-stale",
    BROKER_ADDRESS
  ));
  store.rollbackProcessing(first.attemptId);

  const second = store.beginProcessing(record.quote.quoteId, documents);
  expectStoreError("STALE_PROCESSING_ATTEMPT", () => store.finishSettlement(
    first.attemptId,
    successfulSettlement,
    EXPECTED
  ));
  expectStoreError("STALE_PROCESSING_ATTEMPT", () => store.rollbackProcessing(first.attemptId));
  expectStoreError("STALE_PROCESSING_ATTEMPT", () => store.prepareReceipt(
    record.quote.quoteId,
    first.attemptId,
    BROKER_ADDRESS
  ));
  assert.equal(store.getOrThrow(record.quote.quoteId).attemptId, second.attemptId);
  store.rollbackProcessing(record.quote.quoteId, second.attemptId);
  assert.equal(store.getOrThrow(record.quote.quoteId).status, "OPEN");
});

test("failed settlement atomically returns the quote to OPEN", () => {
  const { store, save } = createStore();
  const record = save();
  const processing = store.beginProcessing(record.quote.quoteId, documents);
  store.prepareReceipt(record.quote.quoteId, processing.attemptId, BROKER_ADDRESS);

  const result = store.finishSettlement(processing.attemptId, {
    success: false,
    network: NETWORK,
    errorReason: "facilitator rejected payment"
  }, EXPECTED);
  assert.equal(result.status, "OPEN");
  assert.equal(result.attemptId, undefined);
  assert.equal(result.preparedReceipt, undefined);
  assert.equal(result.receipt, undefined);
  assert.equal(result.settlement, undefined);
  expectStoreError("STALE_PROCESSING_ATTEMPT", () => store.finishSettlement(
    processing.attemptId,
    successfulSettlement,
    EXPECTED
  ));

  const retry = store.beginProcessing(record.quote.quoteId, documents);
  assert.notEqual(retry.attemptId, processing.attemptId);
});

test("invalid transaction, network, or amount settlement rolls back", () => {
  const { store, save } = createStore();
  const record = save();
  const invalidSettlements = [
    { ...successfulSettlement, transaction: "0x1234" },
    { ...successfulSettlement, network: "eip155:1" },
    { ...successfulSettlement, amount: "10001" }
  ];

  for (const invalidSettlement of invalidSettlements) {
    const processing = store.beginProcessing(record.quote.quoteId, documents);
    expectStoreError("INVALID_SETTLEMENT", () => store.finishSettlement(
      processing.attemptId,
      invalidSettlement,
      EXPECTED
    ));
    const rolledBack = store.getOrThrow(record.quote.quoteId);
    assert.equal(rolledBack.status, "OPEN");
    assert.equal(rolledBack.attemptId, undefined);
    assert.equal(rolledBack.preparedReceipt, undefined);
  }

  const retry = store.beginProcessing(record.quote.quoteId, documents);
  expectStoreError("INVALID_SETTLEMENT", () => store.finishSettlement(
    retry.attemptId,
    successfulSettlement,
    EXPECTED
  ));
  assert.equal(store.getOrThrow(record.quote.quoteId).status, "OPEN");
});

test("duplicate and concurrent reservation attempts have one owner", async () => {
  const { store, save } = createStore();
  const record = save();
  const outcomes = await Promise.allSettled([
    Promise.resolve().then(() => store.beginProcessing(record.quote.quoteId, documents)),
    ...Array.from({ length: 31 }, () => (
      Promise.resolve().then(() => store.beginProcessing(record.quote.quoteId, documents))
    ))
  ]);
  const owners = outcomes.filter((outcome): outcome is PromiseFulfilledResult<ReturnType<QuoteStore["beginProcessing"]>> => (
    outcome.status === "fulfilled"
  ));
  const duplicateErrors = outcomes.filter((outcome): outcome is PromiseRejectedResult => (
    outcome.status === "rejected"
  ));

  assert.equal(owners.length, 1);
  assert.equal(duplicateErrors.length, 31);
  for (const outcome of duplicateErrors) {
    assert.ok(outcome.reason instanceof QuoteStoreError);
    assert.equal(outcome.reason.code, "QUOTE_ALREADY_PROCESSING");
  }
  assert.equal(store.getOrThrow(record.quote.quoteId).status, "PROCESSING");
  store.rollbackProcessing(owners[0]!.value.attemptId);
  assert.equal(store.getOrThrow(record.quote.quoteId).status, "OPEN");
});

test("successful settlement files exactly once and stores typed settlement details", () => {
  const { store, save } = createStore();
  const record = save();
  const processing = store.beginProcessing(record.quote.quoteId, documents);
  const prepared = store.prepareReceipt(record.quote.quoteId, processing.attemptId, {
    brokerAddress: BROKER_ADDRESS,
    receiptId: "CBR-CORE",
    timestamp: new Date("2026-08-29T00:00:01.000Z")
  });
  const finished = store.finishSettlement(processing.attemptId, successfulSettlement, EXPECTED);
  assert.equal(finished.status, "FILED");
  assert.deepEqual(finished.receipt, {
    receiptId: prepared.receiptId,
    declarationId: record.quote.declarationId,
    brokerFeeUsd: record.quote.customsBrokerFeeUsd,
    brokerAddress: BROKER_ADDRESS,
    status: "filed",
    timestamp: finished.receipt?.timestamp
  });
  assert.deepEqual(finished.settlement, successfulSettlement);
  assert.equal(finished.preparedReceipt, undefined);
  expectStoreError("STALE_PROCESSING_ATTEMPT", () => store.rollbackProcessing(processing.attemptId));
});

test("prepareReceipt is idempotent for the owning attempt", () => {
  const { store, save } = createStore();
  const record = save();
  const processing = store.beginProcessing(record.quote.quoteId, documents);
  const first = store.prepareReceipt(record.quote.quoteId, processing.attemptId, {
    brokerAddress: BROKER_ADDRESS,
    receiptId: "CBR-IDEMPOTENT"
  });
  const second = store.prepareReceipt(record.quote.quoteId, processing.attemptId, {
    brokerAddress: "0x3333333333333333333333333333333333333333",
    receiptId: "CBR-DIFFERENT"
  });
  assert.deepEqual(second, first);
});

test("quote store lazily prunes only expired OPEN records", () => {
  let current = new Date("2026-08-29T00:00:00.000Z");
  const store = new QuoteStore({
    maxRecords: 2,
    clock: () => new Date(current.getTime())
  });
  const createQuote = (quoteId: string, quoteTtlSeconds: number) => calculateMockQuote(documents, {
    now: current,
    quoteId,
    declarationId: quoteId,
    quoteTtlSeconds
  });

  store.save(createQuote("QUOTE-EXPIRED", 1), documents);
  current = new Date(current.getTime() + 1_001);
  store.save(createQuote("QUOTE-LIVE", 300), documents);
  assert.equal(store.get("QUOTE-EXPIRED"), undefined);
  assert.equal(store.getOrThrow("QUOTE-LIVE").status, "OPEN");

  const filedQuote = store.getOrThrow("QUOTE-LIVE");
  const filedAttempt = store.beginProcessing(filedQuote.quote.quoteId, documents);
  store.prepareReceipt(filedQuote.quote.quoteId, filedAttempt.attemptId, BROKER_ADDRESS);
  store.finishSettlement(filedAttempt.attemptId, successfulSettlement, EXPECTED);

  const processingQuote = createQuote("QUOTE-PROCESSING", 1);
  store.save(processingQuote, documents);
  const processing = store.beginProcessing(processingQuote.quoteId, documents);
  current = new Date(current.getTime() + 1_001);

  const fullStoreQuote = createQuote("QUOTE-CAPACITY", 300);
  expectStoreError("QUOTE_STORE_CAPACITY", () => store.save(fullStoreQuote, documents));
  assert.equal(store.getOrThrow("QUOTE-LIVE").status, "FILED");
  assert.equal(store.getOrThrow(processingQuote.quoteId).status, "PROCESSING");
  assert.equal(store.getOrThrow(processingQuote.quoteId).attemptId, processing.attemptId);
});

test("settlement schema itself enforces a successful 32-byte transaction hash", () => {
  assert.doesNotThrow(() => SettlementDetailsSchema.parse(successfulSettlement));
  assert.throws(() => SettlementDetailsSchema.parse({
    ...successfulSettlement,
    transaction: "0x"
  }));
  assert.throws(() => SettlementDetailsSchema.parse({
    ...successfulSettlement,
    transaction: `0x${"0".repeat(64)}`
  }));
});
