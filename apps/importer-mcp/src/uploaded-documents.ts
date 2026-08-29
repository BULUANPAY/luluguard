import type {
  ExportDocuments,
  TradeDocumentType,
  TradeItem,
} from "./domain.js";
import type { OrderFile } from "./order-files.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function payload(file: OrderFile): JsonObject | undefined {
  const content = object(file.content);
  return object(content?.payload) ?? content;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function countryCode(value: unknown): string {
  const country = text(value) ?? "";
  if (/taiwan/i.test(country)) return "TW";
  if (/united kingdom|great britain|\bUK\b/i.test(country)) return "GB";
  if (/ireland/i.test(country)) return "IE";
  if (/japan/i.test(country)) return "JP";
  return country;
}

function documentType(
  file: OrderFile,
  content: JsonObject,
): TradeDocumentType | undefined {
  const declared = text(content.document_type)?.toLowerCase();
  const candidate = declared ?? file.documentType;
  return [
    "commercial_invoice",
    "packing_list",
    "bill_of_lading",
    "certificate_of_origin",
    "product_specification",
    "import_permit",
  ].includes(candidate)
    ? (candidate as TradeDocumentType)
    : undefined;
}

export function buildExportDocuments(files: OrderFile[]): ExportDocuments {
  const parsed = files.flatMap((file) => {
    const content = payload(file);
    return content
      ? [{ file, content, type: documentType(file, content) }]
      : [];
  });
  if (parsed.length === 0)
    throw new Error(
      "No JSON documents were found for this order in uploaded-files",
    );

  const invoice = parsed.find(
    (item) => item.type === "commercial_invoice",
  )?.content;
  const packingList = parsed.find(
    (item) => item.type === "packing_list",
  )?.content;
  const billOfLading = parsed.find(
    (item) => item.type === "bill_of_lading",
  )?.content;
  const origin = parsed.find(
    (item) => item.type === "certificate_of_origin",
  )?.content;
  const permit = parsed.find((item) => item.type === "import_permit")?.content;
  const exporter = object(invoice?.exporter);
  const importer = object(invoice?.importer);
  const shipment = object(invoice?.shipment);
  const packages = object(packingList?.packages);
  const weight = object(packingList?.weight);

  if (invoice && invoice.currency !== "USD") {
    throw new Error(
      `Commercial invoice currency ${String(invoice.currency)} is not supported; upload a USD invoice before estimating USD costs`,
    );
  }

  const items: TradeItem[] = Array.isArray(invoice?.items)
    ? invoice.items.flatMap((value) => {
        const item = object(value);
        if (!item) return [];
        return [
          {
            description: text(item.description) ?? "",
            model: text(item.model) ?? text(item.scientific_name) ?? "",
            material: text(item.material) ?? "",
            intendedUse:
              text(item.intendedUse) ?? text(item.intended_use) ?? "",
            quantity: number(item.quantity) ?? 0,
            unitPriceUsd:
              number(item.unitPriceUsd) ?? number(item.unit_price) ?? 0,
            hsCode: text(item.hsCode) ?? text(item.hs_code),
          },
        ];
      })
    : [];

  const incotermValue = text(invoice?.incoterm) ?? text(shipment?.incoterm);
  const incoterm = incotermValue
    ?.match(/^(EXW|FOB|CIF)\b/i)?.[1]
    ?.toUpperCase() as ExportDocuments["incoterm"];
  const types = [
    ...new Set(parsed.flatMap((item) => (item.type ? [item.type] : []))),
  ];

  return {
    invoiceNumber:
      text(invoice?.invoiceNumber) ?? text(invoice?.document_id) ?? "",
    invoiceDate: text(invoice?.invoiceDate) ?? text(invoice?.issue_date),
    exporter: text(exporter?.name) ?? "",
    importer: text(importer?.name) ?? "",
    originCountry: countryCode(
      invoice?.originCountry ??
        shipment?.country_of_origin ??
        exporter?.country,
    ),
    destinationCountry: countryCode(
      invoice?.destinationCountry ?? importer?.country,
    ),
    currency: "USD",
    incoterm,
    freightUsd: number(invoice?.freightUsd) ?? number(invoice?.freight_usd),
    insuranceUsd:
      number(invoice?.insuranceUsd) ?? number(invoice?.insurance_usd),
    packageCount:
      number(packingList?.packageCount) ?? number(packages?.total_packages),
    grossWeightKg:
      number(packingList?.grossWeightKg) ?? number(weight?.gross_weight_kg),
    netWeightKg:
      number(packingList?.netWeightKg) ?? number(weight?.net_weight_kg),
    billOfLadingNumber:
      text(billOfLading?.billOfLadingNumber) ?? text(billOfLading?.document_id),
    certificateOfOriginNumber:
      text(origin?.certificateOfOriginNumber) ?? text(origin?.document_id),
    importPermitNumber:
      text(permit?.importPermitNumber) ?? text(permit?.document_id),
    providedDocuments: types,
    items,
  };
}
