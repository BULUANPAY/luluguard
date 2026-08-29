import { z } from "zod";

export const exportGoodsItemSchema = z.object({
  description: z.string().trim().min(3, "請描述出口貨物"),
  hsCode: z.string().trim().regex(/^\d{6,10}$/, "稅則號列需為 6–10 位數字"),
  packageCount: z.number().int().positive("件數必須是正整數"),
  grossWeightKg: z.number().positive("重量必須大於 0"),
  dangerousGoods: z.boolean(),
});

export const exportObjectFormSchema = z.object({
  reference: z.string().trim().min(1, "請填寫出口物件編號"),
  exporterCompany: z.string().trim().min(1, "請填寫出口商"),
  consigneeName: z.string().trim().min(1, "請填寫收貨人"),
  consigneeCountry: z.string().trim().min(2, "請填寫目的國"),
  invoiceNo: z.string().trim().min(1, "請填寫發票號碼"),
  incoterm: z.enum(["EXW", "FOB", "CIF", "CPT", "DAP", "DDP"]),
  currency: z.enum(["USD", "TWD", "JPY", "EUR"]),
  totalValue: z.number().positive("金額必須大於 0"),
  originCountry: z.string().trim().min(2, "請填寫原產國"),
  destinationPort: z.string().trim().min(2, "請填寫目的港"),
  transportMode: z.enum(["sea", "air", "road"]),
  plannedDepartureDate: z.string().min(1, "請選擇預計出貨日"),
  goods: z.array(exportGoodsItemSchema).min(1, "至少需要一筆貨物"),
});

export type ExportObjectFormValues = z.infer<typeof exportObjectFormSchema>;
export type ExportGoodsItemFormValues = z.infer<typeof exportGoodsItemSchema>;

export interface ExportObjectPayload {
  schemaVersion: "1.0";
  objectType: "export-shipment-draft";
  generatedAt: string;
  reference: string;
  exporter: {
    companyName: string;
    originCountry: string;
  };
  consignee: {
    name: string;
    country: string;
  };
  commercial: {
    invoiceNo: string;
    incoterm: ExportObjectFormValues["incoterm"];
    currency: ExportObjectFormValues["currency"];
    totalValue: number;
  };
  shipment: {
    transportMode: ExportObjectFormValues["transportMode"];
    destinationPort: string;
    plannedDepartureDate: string;
    packageCount: number;
    grossWeightKg: number;
  };
  goods: Array<{
    description: string;
    hsCode: string;
    packageCount: number;
    grossWeightKg: number;
    dangerousGoods: boolean;
  }>;
}

const goodsCatalog = [
  { description: "Scottish White Unicorn", hsCode: "010121" },
  { description: "Highland Silver-Mane Unicorn", hsCode: "010121" },
  { description: "Golden Foal Unicorn", hsCode: "010121" },
  { description: "Moonlit Forest Unicorn", hsCode: "010121" },
] as const;

export function createRandomExportGoodsItem(
  random: () => number = Math.random,
): ExportGoodsItemFormValues {
  const goodsItem = pick(goodsCatalog, random);

  return {
    description: goodsItem.description,
    hsCode: goodsItem.hsCode,
    packageCount: randomInteger(1, 5, random),
    grossWeightKg: randomInteger(380, 2_300, random),
    dangerousGoods: false,
  };
}

export function createRandomExportObject(
  exporterCompany: string,
  now = new Date(),
  random: () => number = Math.random,
): ExportObjectFormValues {
  const destinations = [
    { consignee: "Taiwan Magical Creature Sanctuary", country: "TW", port: "Kaohsiung, TW" },
    { consignee: "Mahoutokoro Unicorn Preserve", country: "JP", port: "Yokohama, JP" },
    { consignee: "Black Forest Magical Menagerie", country: "DE", port: "Hamburg, DE" },
    { consignee: "New Salem Unicorn Reserve", country: "US", port: "New York, US" },
  ] as const;
  const destination = pick(destinations, random);
  const departureDate = new Date(now);
  departureDate.setDate(departureDate.getDate() + randomInteger(3, 18, random));
  const dateStamp = formatDate(now).replaceAll("-", "");

  return {
    reference: `EXP-${dateStamp}-${randomInteger(100, 999, random)}`,
    exporterCompany,
    consigneeName: destination.consignee,
    consigneeCountry: destination.country,
    invoiceNo: `INV-${now.getFullYear()}-${randomInteger(10000, 99999, random)}`,
    incoterm: pick(["FOB", "CIF", "CPT", "DAP"] as const, random),
    currency: pick(["USD", "JPY", "EUR"] as const, random),
    totalValue: randomInteger(25_000, 300_000, random),
    originCountry: "GB",
    destinationPort: destination.port,
    transportMode: pick(["sea", "air"] as const, random),
    plannedDepartureDate: formatDate(departureDate),
    goods: [createRandomExportGoodsItem(random)],
  };
}

export function buildExportObjectPayload(
  values: ExportObjectFormValues,
  now = new Date(),
): ExportObjectPayload {
  const packageCount = values.goods.reduce(
    (total, item) => total + item.packageCount,
    0,
  );
  const grossWeightKg = values.goods.reduce(
    (total, item) => total + item.grossWeightKg,
    0,
  );

  return {
    schemaVersion: "1.0",
    objectType: "export-shipment-draft",
    generatedAt: now.toISOString(),
    reference: values.reference,
    exporter: {
      companyName: values.exporterCompany,
      originCountry: values.originCountry,
    },
    consignee: {
      name: values.consigneeName,
      country: values.consigneeCountry,
    },
    commercial: {
      invoiceNo: values.invoiceNo,
      incoterm: values.incoterm,
      currency: values.currency,
      totalValue: values.totalValue,
    },
    shipment: {
      transportMode: values.transportMode,
      destinationPort: values.destinationPort,
      plannedDepartureDate: values.plannedDepartureDate,
      packageCount,
      grossWeightKg,
    },
    goods: values.goods.map((item) => ({ ...item })),
  };
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
