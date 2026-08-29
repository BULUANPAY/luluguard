export type ExportDocumentType = "COMMERCIAL_INVOICE" | "PACKING_LIST";

export interface Party {
  name: string;
  country: string;
  region?: string;
  address: string;
  vlei: string;
}

export interface ShipmentDetails {
  country_of_origin: string;
  region_of_origin: string;
  country_of_export: string;
  destination: string;
  transport_mode: "SEA" | "AIR";
  vessel: string;
  incoterm?: string;
}

export interface IssuerDetails {
  organization: string;
  authorized_signatory: string;
  role: string;
  credential: string;
}

export interface DocumentSignature {
  type: "DIGITAL_SIGNATURE";
  status: "SIGNED";
  signed_at: string;
}

export interface DemoMetadata {
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

const DEMO_METADATA: DemoMetadata = {
  fictional: true,
  purpose: "Trustworthy AI Agent Hackathon Demo",
  warning: "FICTIONAL DEMO DATA — NOT A REAL TRADE DOCUMENT",
};

export function createEmptyExportDocument(
  documentType: ExportDocumentType,
  exporterName: string,
): ExportDocument {
  const common = {
    document_id: "",
    issue_date: "",
    exporter: {
      name: exporterName,
      country: "",
      region: "",
      address: "",
      vlei: "",
    },
    importer: {
      name: "",
      country: "",
      address: "",
      vlei: "",
    },
    shipment: {
      country_of_origin: "",
      region_of_origin: "",
      country_of_export: "",
      destination: "",
      transport_mode: "SEA" as const,
      vessel: "",
    },
    issuer: {
      organization: exporterName,
      authorized_signatory: "",
      role: "",
      credential: "",
    },
    signature: {
      type: "DIGITAL_SIGNATURE" as const,
      status: "SIGNED" as const,
      signed_at: "",
    },
    demo_metadata: DEMO_METADATA,
  };

  if (documentType === "COMMERCIAL_INVOICE") {
    return {
      ...common,
      document_type: "COMMERCIAL_INVOICE",
      currency: "USD",
      shipment: { ...common.shipment, incoterm: "" },
      items: [
        {
          line_no: 1,
          description: "",
          scientific_name: "",
          hs_code: "",
          quantity: 0,
          unit: "HEAD",
          unit_price: 0,
          amount: 0,
          dpp_batch_id: "",
        },
      ],
      totals: {
        total_quantity: 0,
        total_amount: 0,
        currency: "USD",
      },
    };
  }

  return {
    ...common,
    document_type: "PACKING_LIST",
    related_invoice: "",
    packages: {
      package_type: "",
      total_packages: 0,
      heads_per_package: 0,
      total_quantity: 0,
      unit: "HEAD",
    },
    cargo: [
      {
        line_no: 1,
        description: "",
        scientific_name: "",
        quantity: 0,
        unit: "HEAD",
        dpp_batch_id: "",
      },
    ],
    weight: {
      net_weight_kg: 0,
      gross_weight_kg: 0,
    },
    marks_and_numbers: {
      mark: "",
      range: "",
    },
  };
}

export function createTestExportDocument(
  documentType: ExportDocumentType,
  exporterName: string,
): ExportDocument {
  const common = {
    issue_date: "2026-08-29",
    exporter: {
      name: exporterName,
      country: "United Kingdom",
      region: "Scotland",
      address:
        "12 Glenmore Industrial Estate, Inverness, Scotland, United Kingdom",
      vlei: "LEI-DEMO-SINCLAIR-LIVESTOCK-001",
    },
    importer: {
      name: "Kaohsiung Livestock Import Center",
      country: "Taiwan",
      address: "No. 9, Harbor Road, Kaohsiung, Taiwan",
      vlei: "LEI-DEMO-LIVESTOCK-TW-001",
    },
    shipment: {
      country_of_origin: "United Kingdom",
      region_of_origin: "Scotland",
      country_of_export: "United Kingdom",
      destination: "Port of Kaohsiung, Taiwan",
      transport_mode: "SEA" as const,
      vessel: "MV Caledonian Voyager",
    },
    issuer: {
      organization: exporterName,
      authorized_signatory: "James Sinclair",
      role: "Export Compliance Manager",
      credential: "vLEI-DEMO-SIGNATORY-SLE-001",
    },
    signature: {
      type: "DIGITAL_SIGNATURE" as const,
      status: "SIGNED" as const,
      signed_at: "2026-08-29T10:30:00+08:00",
    },
    demo_metadata: DEMO_METADATA,
  };

  if (documentType === "COMMERCIAL_INVOICE") {
    return {
      ...common,
      document_type: "COMMERCIAL_INVOICE",
      document_id: "INV-UNI-20260829-001",
      currency: "USD",
      shipment: { ...common.shipment, incoterm: "CIF Kaohsiung" },
      items: [
        {
          line_no: 1,
          description: "Highland Pony",
          scientific_name: "Equus ferus caballus",
          hs_code: "0101.21",
          quantity: 2,
          unit: "HEAD",
          unit_price: 35000,
          amount: 70000,
          dpp_batch_id: "DPP-EQUUS-SCO-20260829-001",
        },
      ],
      totals: {
        total_quantity: 2,
        total_amount: 70000,
        currency: "USD",
      },
    };
  }

  return {
    ...common,
    document_type: "PACKING_LIST",
    document_id: "PL-UNI-20260829-001",
    related_invoice: "INV-UNI-20260829-001",
    packages: {
      package_type: "Livestock Transport Container",
      total_packages: 2,
      heads_per_package: 1,
      total_quantity: 2,
      unit: "HEAD",
    },
    cargo: [
      {
        line_no: 1,
        description: "Highland Pony",
        scientific_name: "Equus ferus caballus",
        quantity: 2,
        unit: "HEAD",
        dpp_batch_id: "DPP-EQUUS-SCO-20260829-001",
      },
    ],
    weight: {
      net_weight_kg: 840,
      gross_weight_kg: 1680,
    },
    marks_and_numbers: {
      mark: "SINCLAIR LIVESTOCK",
      range: "LOT-00001 ~ LOT-00002",
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
