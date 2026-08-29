export type ExportDocumentType = "COMMERCIAL_INVOICE" | "PACKING_LIST";

interface Party {
  name: string;
  country: string;
  region?: string;
  address: string;
  vlei: string;
}

interface ShipmentDetails {
  country_of_origin: string;
  region_of_origin: string;
  country_of_export: string;
  destination: string;
  transport_mode: "SEA" | "AIR";
  vessel: string;
  incoterm?: string;
}

interface IssuerDetails {
  organization: string;
  authorized_signatory: string;
  role: string;
  credential: string;
}

interface DocumentSignature {
  type: "DIGITAL_SIGNATURE";
  status: "SIGNED";
  signed_at: string;
}

interface DemoMetadata {
  fictional: true;
  purpose: "Trustworthy AI Agent Hackathon Demo";
  warning: "FICTIONAL DEMO DATA — NOT A REAL TRADE DOCUMENT";
}

interface ExportDocumentBase {
  document_id: string;
  issue_date: string;
  exporter: Party;
  importer: Party;
  shipment: ShipmentDetails;
  issuer: IssuerDetails;
  signature: DocumentSignature;
  demo_metadata: DemoMetadata;
}

export interface CommercialInvoice extends ExportDocumentBase {
  document_type: "COMMERCIAL_INVOICE";
  currency: "USD" | "GBP";
  shipment: ShipmentDetails & { incoterm: string };
  items: Array<{
    line_no: number;
    description: string;
    scientific_name: string;
    hs_code: string;
    quantity: number;
    unit: "HEAD";
    unit_price: number;
    amount: number;
    dpp_batch_id: string;
  }>;
  totals: {
    total_quantity: number;
    total_amount: number;
    currency: CommercialInvoice["currency"];
  };
}

export interface PackingList extends ExportDocumentBase {
  document_type: "PACKING_LIST";
  related_invoice: string;
  packages: {
    package_type: string;
    total_packages: number;
    heads_per_package: number;
    total_quantity: number;
    unit: "HEAD";
  };
  cargo: Array<{
    line_no: number;
    description: string;
    scientific_name: string;
    quantity: number;
    unit: "HEAD";
    dpp_batch_id: string;
  }>;
  weight: {
    net_weight_kg: number;
    gross_weight_kg: number;
  };
  marks_and_numbers: {
    mark: string;
    range: string;
  };
}

export type ExportDocument = CommercialInvoice | PackingList;

const exporters = [
  {
    country: "United Kingdom",
    region: "Scotland",
    address: "12 Glenmore Industrial Estate, Inverness, Scotland, United Kingdom",
    vlei: "LEI-DEMO-SINCLAIR-LIVESTOCK-001",
    signatory: "James Sinclair",
    role: "Export Compliance Manager",
    credential: "vLEI-DEMO-SIGNATORY-SLE-001",
    vessel: "MV Caledonian Voyager",
  },
] as const;

const importers = [
  {
    name: "Kaohsiung Livestock Import Center",
    country: "Taiwan",
    address: "No. 9, Harbor Road, Kaohsiung, Taiwan",
    vlei: "LEI-DEMO-LIVESTOCK-TW-001",
    destination: "Port of Kaohsiung, Taiwan",
  },
  {
    name: "Yokohama Equine Import Association",
    country: "Japan",
    address: "7 Sakura Lane, Yokohama, Japan",
    vlei: "LEI-DEMO-EQUINE-JP-002",
    destination: "Port of Yokohama, Japan",
  },
] as const;

const products = [
  {
    description: "Highland Pony",
    scientificName: "Equus ferus caballus",
    hsCode: "0101.21",
  },
  {
    description: "Connemara Pony",
    scientificName: "Equus ferus caballus",
    hsCode: "0101.21",
  },
  {
    description: "Fell Pony",
    scientificName: "Equus ferus caballus",
    hsCode: "0101.21",
  },
] as const;

export function createRandomExportDocument(
  documentType: ExportDocumentType,
  exporterName: string,
  now = new Date(),
  random: () => number = Math.random,
): ExportDocument {
  const exporterProfile = pick(exporters, random);
  const importer = pick(importers, random);
  const product = pick(products, random);
  const quantity = randomInteger(1, 5, random);
  const headsPerPackage = 1;
  const totalPackages = Math.ceil(quantity / headsPerPackage);
  const unitPrice = randomInteger(25, 60, random) * 1_000;
  const totalAmount = quantity * unitPrice;
  const netWeight = quantity * randomInteger(380, 460, random);
  const grossWeight =
    netWeight + totalPackages * randomInteger(350, 650, random);
  const documentDate = formatDate(now);
  const dateStamp = documentDate.replaceAll("-", "");
  const serial = randomInteger(100, 999, random);
  const invoiceId = `INV-UNI-${dateStamp}-${serial}`;
  const batchId = `DPP-EQUUS-${exporterProfile.region.slice(0, 3).toUpperCase()}-${dateStamp}-${serial}`;
  const signedAt = toSignedAt(now);

  const common = {
    issue_date: documentDate,
    exporter: {
      name: exporterName,
      country: exporterProfile.country,
      region: exporterProfile.region,
      address: exporterProfile.address,
      vlei: exporterProfile.vlei,
    },
    importer: {
      name: importer.name,
      country: importer.country,
      address: importer.address,
      vlei: importer.vlei,
    },
    shipment: {
      country_of_origin: exporterProfile.country,
      region_of_origin: exporterProfile.region,
      country_of_export: exporterProfile.country,
      destination: importer.destination,
      transport_mode: "SEA" as const,
      vessel: exporterProfile.vessel,
    },
    issuer: {
      organization: exporterName,
      authorized_signatory: exporterProfile.signatory,
      role: exporterProfile.role,
      credential: exporterProfile.credential,
    },
    signature: {
      type: "DIGITAL_SIGNATURE" as const,
      status: "SIGNED" as const,
      signed_at: signedAt,
    },
    demo_metadata: {
      fictional: true as const,
      purpose: "Trustworthy AI Agent Hackathon Demo" as const,
      warning: "FICTIONAL DEMO DATA — NOT A REAL TRADE DOCUMENT" as const,
    },
  };

  if (documentType === "COMMERCIAL_INVOICE") {
    const currency = pick(["USD", "GBP"] as const, random);
    return {
      ...common,
      document_type: "COMMERCIAL_INVOICE",
      document_id: invoiceId,
      currency,
      shipment: { ...common.shipment, incoterm: "CIF Keelung" },
      items: [
        {
          line_no: 1,
          description: product.description,
          scientific_name: product.scientificName,
          hs_code: product.hsCode,
          quantity,
          unit: "HEAD",
          unit_price: unitPrice,
          amount: totalAmount,
          dpp_batch_id: batchId,
        },
      ],
      totals: {
        total_quantity: quantity,
        total_amount: totalAmount,
        currency,
      },
    };
  }

  return {
    ...common,
    document_type: "PACKING_LIST",
    document_id: `PL-UNI-${dateStamp}-${serial}`,
    related_invoice: invoiceId,
    packages: {
      package_type: "Livestock Transport Container",
      total_packages: totalPackages,
      heads_per_package: headsPerPackage,
      total_quantity: quantity,
      unit: "HEAD",
    },
    cargo: [
      {
        line_no: 1,
        description: product.description,
        scientific_name: product.scientificName,
        quantity,
        unit: "HEAD",
        dpp_batch_id: batchId,
      },
    ],
    weight: {
      net_weight_kg: netWeight,
      gross_weight_kg: grossWeight,
    },
    marks_and_numbers: {
      mark: exporterName.split(" ").slice(0, 2).join(" ").toUpperCase(),
        range: `LOT-00001 ~ LOT-${String(quantity).padStart(5, "0")}`,
    },
  };
}

export function parseExportDocument(
  json: string,
  expectedType?: ExportDocumentType,
): ExportDocument {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("JSON 格式不正確，請檢查逗號、引號與括號。");
  }

  if (!isRecord(value)) {
    throw new Error("文件 Body 必須是 JSON object。");
  }
  if (
    value.document_type !== "COMMERCIAL_INVOICE" &&
    value.document_type !== "PACKING_LIST"
  ) {
    throw new Error(
      "document_type 必須是 COMMERCIAL_INVOICE 或 PACKING_LIST。",
    );
  }
  if (expectedType && value.document_type !== expectedType) {
    throw new Error(
      `目前選擇的文件類型是 ${expectedType}，但 JSON 內容不一致。`,
    );
  }
  if (typeof value.document_id !== "string" || !value.document_id.trim()) {
    throw new Error("document_id 不可空白。");
  }
  if (
    !isRecord(value.exporter) ||
    !isRecord(value.importer) ||
    !isRecord(value.issuer)
  ) {
    throw new Error("文件必須包含 exporter、importer 與 issuer object。");
  }

  return value as unknown as ExportDocument;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] ?? items[0]!;
}

function randomInteger(min: number, max: number, random: () => number) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toSignedAt(date: Date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(
    2,
    "0",
  );
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  return `${formatDate(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}${sign}${hours}:${minutes}`;
}
