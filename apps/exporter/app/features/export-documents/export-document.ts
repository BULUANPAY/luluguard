import { z } from "zod";

export type ExportDocumentType =
  "COMMERCIAL_INVOICE" | "PACKING_LIST" | "DIGITAL_PRODUCT_PASSPORT";

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

export interface DigitalProductPassport extends ExportDocumentBase {
  document_type: "DIGITAL_PRODUCT_PASSPORT";
  dpp_id: string;
  product: {
    name: string;
    model: string;
    hs_code: string;
    batch_id: string;
    quantity: number;
    unit: "HEAD";
  };
  carbon_footprint: {
    product_carbon_footprint_kg_co2e: number;
    baseline_kg_co2e: number;
    reduction_percent: number;
    methodology: string;
    system_boundary: string;
    verification_standard: string;
    verified_by: string;
    verified_at: string;
  };
  validity: {
    valid_from: string;
    valid_until: string;
  };
}

export type ExportDocument =
  CommercialInvoice | PackingList | DigitalProductPassport;

const partySchema = z
  .object({
    name: z.string(),
    country: z.string(),
    region: z.string().optional(),
    address: z.string(),
    vlei: z.string(),
  })
  .passthrough();
const shipmentSchema = z
  .object({
    country_of_origin: z.string(),
    region_of_origin: z.string(),
    country_of_export: z.string(),
    destination: z.string(),
    transport_mode: z.enum(["SEA", "AIR"]),
    vessel: z.string(),
  })
  .passthrough();
const issuerSchema = z
  .object({
    organization: z.string(),
    authorized_signatory: z.string(),
    role: z.string(),
    credential: z.string(),
  })
  .passthrough();
const signatureSchema = z
  .object({
    type: z.literal("DIGITAL_SIGNATURE"),
    status: z.literal("SIGNED"),
    signed_at: z.string(),
  })
  .passthrough();
const demoMetadataSchema = z
  .object({
    fictional: z.literal(true),
    purpose: z.literal("Trustworthy AI Agent Hackathon Demo"),
    warning: z.literal("FICTIONAL DEMO DATA — NOT A REAL TRADE DOCUMENT"),
  })
  .passthrough();
const documentBaseSchema = z
  .object({
    document_id: z.string().trim().min(1),
    issue_date: z.string(),
    exporter: partySchema,
    importer: partySchema,
    shipment: shipmentSchema,
    issuer: issuerSchema,
    signature: signatureSchema,
    demo_metadata: demoMetadataSchema,
  })
  .passthrough();
const invoiceSchema = documentBaseSchema.extend({
  document_type: z.literal("COMMERCIAL_INVOICE"),
  currency: z.enum(["USD", "GBP"]),
  shipment: shipmentSchema.extend({ incoterm: z.string() }),
  items: z
    .array(
      z
        .object({
          line_no: z.number().finite(),
          description: z.string(),
          scientific_name: z.string(),
          hs_code: z.string(),
          quantity: z.number().finite(),
          unit: z.literal("HEAD"),
          unit_price: z.number().finite(),
          amount: z.number().finite(),
          dpp_batch_id: z.string(),
        })
        .passthrough(),
    )
    .min(1),
  totals: z
    .object({
      total_quantity: z.number().finite(),
      total_amount: z.number().finite(),
      currency: z.enum(["USD", "GBP"]),
    })
    .passthrough(),
});
const packingListSchema = documentBaseSchema.extend({
  document_type: z.literal("PACKING_LIST"),
  related_invoice: z.string(),
  packages: z
    .object({
      package_type: z.string(),
      total_packages: z.number().finite(),
      heads_per_package: z.number().finite(),
      total_quantity: z.number().finite(),
      unit: z.literal("HEAD"),
    })
    .passthrough(),
  cargo: z
    .array(
      z
        .object({
          line_no: z.number().finite(),
          description: z.string(),
          scientific_name: z.string(),
          quantity: z.number().finite(),
          unit: z.literal("HEAD"),
          dpp_batch_id: z.string(),
        })
        .passthrough(),
    )
    .min(1),
  weight: z
    .object({
      net_weight_kg: z.number().finite(),
      gross_weight_kg: z.number().finite(),
    })
    .passthrough(),
  marks_and_numbers: z
    .object({ mark: z.string(), range: z.string() })
    .passthrough(),
});
const digitalProductPassportSchema = documentBaseSchema.extend({
  document_type: z.literal("DIGITAL_PRODUCT_PASSPORT"),
  dpp_id: z.string().trim().min(1),
  product: z
    .object({
      name: z.string().trim().min(1),
      model: z.string().trim().min(1),
      hs_code: z.string().trim().min(1),
      batch_id: z.string().trim().min(1),
      quantity: z.number().positive(),
      unit: z.literal("HEAD"),
    })
    .passthrough(),
  carbon_footprint: z
    .object({
      product_carbon_footprint_kg_co2e: z.number().nonnegative(),
      baseline_kg_co2e: z.number().positive(),
      reduction_percent: z.number().min(0).max(100),
      methodology: z.string().trim().min(1),
      system_boundary: z.string().trim().min(1),
      verification_standard: z.string().trim().min(1),
      verified_by: z.string().trim().min(1),
      verified_at: z.string().trim().min(1),
    })
    .passthrough(),
  validity: z
    .object({
      valid_from: z.string().trim().min(1),
      valid_until: z.string().trim().min(1),
    })
    .passthrough(),
});
const exportDocumentSchema = z.discriminatedUnion("document_type", [
  invoiceSchema,
  packingListSchema,
  digitalProductPassportSchema,
]);

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

  if (documentType === "DIGITAL_PRODUCT_PASSPORT") {
    return {
      ...common,
      document_type: "DIGITAL_PRODUCT_PASSPORT",
      dpp_id: "",
      product: {
        name: "",
        model: "",
        hs_code: "",
        batch_id: "",
        quantity: 0,
        unit: "HEAD",
      },
      carbon_footprint: {
        product_carbon_footprint_kg_co2e: 0,
        baseline_kg_co2e: 0,
        reduction_percent: 0,
        methodology: "",
        system_boundary: "",
        verification_standard: "",
        verified_by: "",
        verified_at: "",
      },
      validity: { valid_from: "", valid_until: "" },
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
      address: "88 Highland Way, Edinburgh, Scotland, United Kingdom",
      vlei: "LEI-DEMO-SCOTTISH-UNICORN-EXPORTS-001",
    },
    importer: {
      name: "Formosa Unicorn Imports Co., Ltd.",
      country: "Taiwan",
      address: "No. 100, Harbor Road, Kaohsiung, Taiwan",
      vlei: "LEI-DEMO-FORMOSA-UNICORN-IMPORTS-001",
    },
    shipment: {
      country_of_origin: "United Kingdom",
      region_of_origin: "Scotland",
      country_of_export: "United Kingdom",
      destination: "Port of Kaohsiung, Taiwan",
      transport_mode: "SEA" as const,
      vessel: "MV Highland Rainbow",
    },
    issuer: {
      organization: exporterName,
      authorized_signatory: "Isla MacLeod",
      role: "Export Compliance Manager",
      credential: "vLEI-DEMO-SIGNATORY-SUE-001",
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
          description: "Unicorn",
          scientific_name: "Equus unicornis scoticus",
          hs_code: "0101.21",
          quantity: 10000,
          unit: "HEAD",
          unit_price: 5000,
          amount: 50000000,
          dpp_batch_id: "DPP-UNICORN-SCO-20260829-001",
        },
      ],
      totals: {
        total_quantity: 10000,
        total_amount: 50000000,
        currency: "USD",
      },
    };
  }

  if (documentType === "DIGITAL_PRODUCT_PASSPORT") {
    return {
      ...common,
      document_type: "DIGITAL_PRODUCT_PASSPORT",
      document_id: "DPP-UNI-20260829-001",
      dpp_id: "DPP-UNICORN-SCO-20260829-001",
      product: {
        name: "Unicorn",
        model: "Equus unicornis scoticus",
        hs_code: "0101.21",
        batch_id: "DPP-UNICORN-SCO-20260829-001",
        quantity: 10000,
        unit: "HEAD",
      },
      carbon_footprint: {
        product_carbon_footprint_kg_co2e: 360,
        baseline_kg_co2e: 500,
        reduction_percent: 28,
        methodology: "ISO 14067 product carbon footprint",
        system_boundary: "Cradle-to-port",
        verification_standard: "ISO 14064-3",
        verified_by: "Caledonia Carbon Verification Ltd.",
        verified_at: "2026-08-28T09:00:00+01:00",
      },
      validity: {
        valid_from: "2026-08-29",
        valid_until: "2027-08-28",
      },
    };
  }

  return {
    ...common,
    document_type: "PACKING_LIST",
    document_id: "PL-UNI-20260829-001",
    related_invoice: "INV-UNI-20260829-001",
    packages: {
      package_type: "Magical Livestock Transport Container",
      total_packages: 1000,
      heads_per_package: 10,
      total_quantity: 10000,
      unit: "HEAD",
    },
    cargo: [
      {
        line_no: 1,
        description: "Unicorn",
        scientific_name: "Equus unicornis scoticus",
        quantity: 10000,
        unit: "HEAD",
        dpp_batch_id: "DPP-UNICORN-SCO-20260829-001",
      },
    ],
    weight: {
      net_weight_kg: 4200000,
      gross_weight_kg: 5000000,
    },
    marks_and_numbers: {
      mark: "SCOTTISH UNICORN EXPORT",
      range: "LOT-00001 ~ LOT-10000",
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
    value.document_type !== "PACKING_LIST" &&
    value.document_type !== "DIGITAL_PRODUCT_PASSPORT"
  ) {
    throw new Error(
      "document_type 必須是 COMMERCIAL_INVOICE、PACKING_LIST 或 DIGITAL_PRODUCT_PASSPORT。",
    );
  }
  if (expectedType && value.document_type !== expectedType) {
    throw new Error(
      `目前選擇的文件類型是 ${expectedType}，但 JSON 內容不一致。`,
    );
  }
  const parsed = exportDocumentSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || "Body";
    throw new Error(
      `${field} 格式不正確${issue?.message ? `：${issue.message}` : "。"}`,
    );
  }

  return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
