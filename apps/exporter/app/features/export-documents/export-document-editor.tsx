import { Button } from "@luluguard/ui/components/button";
import { Input } from "@luluguard/ui/components/input";
import { Database, Send } from "lucide-react";
import { useState, type ReactNode } from "react";

import type {
  ExportDocument,
  IssuerDetails,
  Party,
  ShipmentDetails,
  TestDataSet,
} from "./export-document";

type UpdateDocument = (mutate: (draft: ExportDocument) => void) => void;

export function ExportDocumentEditor({
  document,
  error,
  isSubmitting,
  onChange,
  onSubmit,
  onUseTestData,
}: {
  document: ExportDocument;
  error?: string;
  isSubmitting: boolean;
  onChange: (document: ExportDocument) => void;
  onSubmit: () => void;
  onUseTestData: (dataSet: TestDataSet) => void;
}) {
  const [testDataSet, setTestDataSet] = useState<TestDataSet>("UNICORN");
  const update: UpdateDocument = (mutate) => {
    const nextDocument = structuredClone(document);
    mutate(nextDocument);
    onChange(nextDocument);
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
        <div>
          <p className="text-sm font-bold">固定 JSON 格式</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            修改欄位時，右側 JSON 會立即同步。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label="測試資料"
            onChange={(value) => setTestDataSet(value as TestDataSet)}
            options={["UNICORN", "UFO"]}
            optionLabels={{ UNICORN: "獨角獸 10,000 頭", UFO: "飛碟 50 台" }}
            value={testDataSet}
          />
          <Button
            disabled={isSubmitting}
            onClick={() => onUseTestData(testDataSet)}
            type="button"
            variant="outline"
          >
            <Database className="size-4" />
            帶入測試資料
          </Button>
        </div>
      </div>

      <Section title="文件資訊">
        <TextField
          label="文件編號"
          onChange={(value) => update((draft) => (draft.document_id = value))}
          required
          value={document.document_id}
        />
        <TextField
          label="發行日期"
          onChange={(value) => update((draft) => (draft.issue_date = value))}
          type="date"
          value={document.issue_date}
        />
        <FixedValue label="文件類型" value={document.document_type} />
      </Section>

      <PartySection
        onChange={(party) => update((draft) => (draft.exporter = party))}
        party={document.exporter}
        title="出口商"
      />
      <PartySection
        onChange={(party) => update((draft) => (draft.importer = party))}
        party={document.importer}
        title="進口商"
      />
      <ShipmentSection document={document} update={update} />

      {document.document_type === "COMMERCIAL_INVOICE" ? (
        <InvoiceFields document={document} update={update} />
      ) : document.document_type === "PACKING_LIST" ? (
        <PackingListFields document={document} update={update} />
      ) : (
        <DigitalProductPassportFields document={document} update={update} />
      )}

      <IssuerSection
        issuer={document.issuer}
        onChange={(issuer) => update((draft) => (draft.issuer = issuer))}
      />
      <Section title="簽章資訊">
        <FixedValue label="簽章類型" value={document.signature.type} />
        <FixedValue label="簽章狀態" value={document.signature.status} />
        <TextField
          label="簽章時間"
          onChange={(value) =>
            update((draft) => (draft.signature.signed_at = value))
          }
          placeholder="2026-08-29T10:30:00+08:00"
          value={document.signature.signed_at}
        />
      </Section>

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="flex justify-end border-t border-border pt-5">
        <Button disabled={isSubmitting} type="submit">
          <Send className="size-4" />
          {isSubmitting ? "簽章送出中…" : "送出至 vLEI 簽章 API"}
        </Button>
      </div>
    </form>
  );
}

function InvoiceFields({
  document,
  update,
}: {
  document: Extract<ExportDocument, { document_type: "COMMERCIAL_INVOICE" }>;
  update: UpdateDocument;
}) {
  const item = document.items[0]!;
  return (
    <>
      <Section title="發票項目">
        <TextField
          label="發票號碼"
          onChange={(value) =>
            updateInvoice(update, (draft) => (draft.invoice_number = value))
          }
          required
          value={document.invoice_number}
        />
        <SelectField
          label="幣別"
          onChange={(value) =>
            updateInvoice(update, (draft) => {
              draft.currency = value as "USD" | "GBP";
              draft.totals.currency = value as "USD" | "GBP";
            })
          }
          options={["USD", "GBP"]}
          value={document.currency}
        />
        <NumberField
          label="運費（USD）"
          onChange={(value) =>
            updateInvoice(update, (draft) => (draft.freight_usd = value))
          }
          value={document.freight_usd}
        />
        <NumberField
          label="保險費（USD）"
          onChange={(value) =>
            updateInvoice(update, (draft) => (draft.insurance_usd = value))
          }
          value={document.insurance_usd}
        />
        <NumberField label="項次" readOnly value={item.line_no} />
        <TextField
          label="品名"
          onChange={(value) =>
            updateInvoiceItem(update, (draft) => (draft.description = value))
          }
          value={item.description}
        />
        <TextField
          label="產品型號"
          onChange={(value) =>
            updateInvoiceItem(update, (draft) => (draft.model = value))
          }
          value={item.model}
        />
        <TextField
          label="HS Code"
          onChange={(value) =>
            updateInvoiceItem(update, (draft) => (draft.hs_code = value))
          }
          value={item.hs_code}
        />
        <NumberField
          label="數量"
          onChange={(value) =>
            updateInvoiceItem(update, (draft) => (draft.quantity = value))
          }
          value={item.quantity}
        />
        <TextField
          label="單位"
          onChange={(value) =>
            updateInvoiceItem(update, (draft) => (draft.unit = value))
          }
          placeholder="例如：PCS、KG、BOX"
          required
          value={item.unit}
        />
        <NumberField
          label="單價"
          onChange={(value) =>
            updateInvoiceItem(update, (draft) => (draft.unit_price = value))
          }
          value={item.unit_price}
        />
        <NumberField
          label="金額"
          onChange={(value) =>
            updateInvoiceItem(update, (draft) => (draft.amount = value))
          }
          value={item.amount}
        />
        <TextField
          label="DPP Batch ID"
          onChange={(value) =>
            updateInvoiceItem(update, (draft) => (draft.dpp_batch_id = value))
          }
          value={item.dpp_batch_id}
        />
      </Section>
      <Section title="發票總計">
        <NumberField
          label="總數量"
          onChange={(value) =>
            updateInvoice(
              update,
              (draft) => (draft.totals.total_quantity = value),
            )
          }
          value={document.totals.total_quantity}
        />
        <NumberField
          label="總金額"
          onChange={(value) =>
            updateInvoice(
              update,
              (draft) => (draft.totals.total_amount = value),
            )
          }
          value={document.totals.total_amount}
        />
        <FixedValue label="總計幣別" value={document.totals.currency} />
      </Section>
    </>
  );
}

function PackingListFields({
  document,
  update,
}: {
  document: Extract<ExportDocument, { document_type: "PACKING_LIST" }>;
  update: UpdateDocument;
}) {
  const cargo = document.cargo[0]!;
  return (
    <>
      <Section title="裝箱資訊">
        <TextField
          label="關聯發票"
          onChange={(value) =>
            updatePackingList(
              update,
              (draft) => (draft.related_invoice = value),
            )
          }
          value={document.related_invoice}
        />
        <TextField
          label="包裝類型"
          onChange={(value) =>
            updatePackingList(
              update,
              (draft) => (draft.packages.package_type = value),
            )
          }
          value={document.packages.package_type}
        />
        <NumberField
          label="總包裝數"
          onChange={(value) =>
            updatePackingList(
              update,
              (draft) => (draft.packages.total_packages = value),
            )
          }
          value={document.packages.total_packages}
        />
        <NumberField
          label="每包裝數量"
          onChange={(value) =>
            updatePackingList(
              update,
              (draft) => (draft.packages.quantity_per_package = value),
            )
          }
          value={document.packages.quantity_per_package}
        />
        <NumberField
          label="總數量"
          onChange={(value) =>
            updatePackingList(
              update,
              (draft) => (draft.packages.total_quantity = value),
            )
          }
          value={document.packages.total_quantity}
        />
        <TextField
          label="單位"
          onChange={(value) =>
            updatePackingList(update, (draft) => (draft.packages.unit = value))
          }
          placeholder="例如：PCS、KG、BOX"
          required
          value={document.packages.unit}
        />
      </Section>
      <Section title="貨物內容">
        <NumberField label="項次" readOnly value={cargo.line_no} />
        <TextField
          label="品名"
          onChange={(value) =>
            updatePackingCargo(update, (draft) => (draft.description = value))
          }
          value={cargo.description}
        />
        <NumberField
          label="數量"
          onChange={(value) =>
            updatePackingCargo(update, (draft) => (draft.quantity = value))
          }
          value={cargo.quantity}
        />
        <TextField
          label="單位"
          onChange={(value) =>
            updatePackingCargo(update, (draft) => (draft.unit = value))
          }
          placeholder="例如：PCS、KG、BOX"
          required
          value={cargo.unit}
        />
        <TextField
          label="DPP Batch ID"
          onChange={(value) =>
            updatePackingCargo(update, (draft) => (draft.dpp_batch_id = value))
          }
          value={cargo.dpp_batch_id}
        />
      </Section>
      <Section title="重量與嘜頭">
        <NumberField
          label="淨重（kg）"
          onChange={(value) =>
            updatePackingList(
              update,
              (draft) => (draft.weight.net_weight_kg = value),
            )
          }
          value={document.weight.net_weight_kg}
        />
        <NumberField
          label="毛重（kg）"
          onChange={(value) =>
            updatePackingList(
              update,
              (draft) => (draft.weight.gross_weight_kg = value),
            )
          }
          value={document.weight.gross_weight_kg}
        />
        <TextField
          label="嘜頭"
          onChange={(value) =>
            updatePackingList(
              update,
              (draft) => (draft.marks_and_numbers.mark = value),
            )
          }
          value={document.marks_and_numbers.mark}
        />
        <TextField
          label="編號範圍"
          onChange={(value) =>
            updatePackingList(
              update,
              (draft) => (draft.marks_and_numbers.range = value),
            )
          }
          value={document.marks_and_numbers.range}
        />
      </Section>
    </>
  );
}

function DigitalProductPassportFields({
  document,
  update,
}: {
  document: Extract<
    ExportDocument,
    { document_type: "DIGITAL_PRODUCT_PASSPORT" }
  >;
  update: UpdateDocument;
}) {
  return (
    <>
      <Section title="數位產品護照">
        <TextField
          label="DPP ID"
          onChange={(value) =>
            updateDigitalProductPassport(
              update,
              (draft) => (draft.dpp_id = value),
            )
          }
          value={document.dpp_id}
        />
        <TextField
          label="產品名稱"
          onChange={(value) =>
            updateDppProduct(update, (draft) => (draft.name = value))
          }
          value={document.product.name}
        />
        <TextField
          label="產品型號"
          onChange={(value) =>
            updateDppProduct(update, (draft) => (draft.model = value))
          }
          value={document.product.model}
        />
        <TextField
          label="HS Code"
          onChange={(value) =>
            updateDppProduct(update, (draft) => (draft.hs_code = value))
          }
          value={document.product.hs_code}
        />
        <TextField
          label="批次 ID"
          onChange={(value) =>
            updateDppProduct(update, (draft) => (draft.batch_id = value))
          }
          value={document.product.batch_id}
        />
        <NumberField
          label="數量"
          onChange={(value) =>
            updateDppProduct(update, (draft) => (draft.quantity = value))
          }
          value={document.product.quantity}
        />
        <TextField
          label="單位"
          onChange={(value) =>
            updateDppProduct(update, (draft) => (draft.unit = value))
          }
          placeholder="例如：PCS、KG、BOX"
          required
          value={document.product.unit}
        />
      </Section>
      <Section title="產品碳足跡與第三方查證">
        <NumberField
          label="產品碳足跡（kg CO₂e／單位）"
          onChange={(value) =>
            updateDppCarbonFootprint(
              update,
              (draft) => (draft.product_carbon_footprint_kg_co2e = value),
            )
          }
          value={document.carbon_footprint.product_carbon_footprint_kg_co2e}
        />
        <NumberField
          label="基準碳足跡（kg CO₂e／單位）"
          onChange={(value) =>
            updateDppCarbonFootprint(
              update,
              (draft) => (draft.baseline_kg_co2e = value),
            )
          }
          value={document.carbon_footprint.baseline_kg_co2e}
        />
        <NumberField
          label="減量比例（%）"
          onChange={(value) =>
            updateDppCarbonFootprint(
              update,
              (draft) => (draft.reduction_percent = value),
            )
          }
          value={document.carbon_footprint.reduction_percent}
        />
        <TextField
          label="盤查方法"
          onChange={(value) =>
            updateDppCarbonFootprint(
              update,
              (draft) => (draft.methodology = value),
            )
          }
          value={document.carbon_footprint.methodology}
        />
        <TextField
          label="系統邊界"
          onChange={(value) =>
            updateDppCarbonFootprint(
              update,
              (draft) => (draft.system_boundary = value),
            )
          }
          value={document.carbon_footprint.system_boundary}
        />
        <TextField
          label="查證標準"
          onChange={(value) =>
            updateDppCarbonFootprint(
              update,
              (draft) => (draft.verification_standard = value),
            )
          }
          value={document.carbon_footprint.verification_standard}
        />
        <TextField
          label="查證機構"
          onChange={(value) =>
            updateDppCarbonFootprint(
              update,
              (draft) => (draft.verified_by = value),
            )
          }
          value={document.carbon_footprint.verified_by}
        />
        <TextField
          label="查證時間"
          onChange={(value) =>
            updateDppCarbonFootprint(
              update,
              (draft) => (draft.verified_at = value),
            )
          }
          placeholder="2026-08-28T09:00:00+01:00"
          value={document.carbon_footprint.verified_at}
        />
      </Section>
      <Section title="護照效期">
        <TextField
          label="生效日"
          onChange={(value) =>
            updateDigitalProductPassport(
              update,
              (draft) => (draft.validity.valid_from = value),
            )
          }
          type="date"
          value={document.validity.valid_from}
        />
        <TextField
          label="到期日"
          onChange={(value) =>
            updateDigitalProductPassport(
              update,
              (draft) => (draft.validity.valid_until = value),
            )
          }
          type="date"
          value={document.validity.valid_until}
        />
      </Section>
    </>
  );
}

function PartySection({
  onChange,
  party,
  title,
}: {
  onChange: (party: Party) => void;
  party: Party;
  title: string;
}) {
  const change = (key: keyof Party, value: string) =>
    onChange({ ...party, [key]: value });
  return (
    <Section title={title}>
      <TextField
        label="名稱"
        onChange={(value) => change("name", value)}
        value={party.name}
      />
      <TextField
        label="國家"
        onChange={(value) => change("country", value)}
        value={party.country}
      />
      <TextField
        label="地區"
        onChange={(value) => change("region", value)}
        value={party.region ?? ""}
      />
      <TextField
        label="地址"
        onChange={(value) => change("address", value)}
        value={party.address}
      />
      <TextField
        label="vLEI"
        onChange={(value) => change("vlei", value)}
        value={party.vlei}
      />
    </Section>
  );
}

function ShipmentSection({
  document,
  update,
}: {
  document: ExportDocument;
  update: UpdateDocument;
}) {
  const change = (key: keyof ShipmentDetails, value: string) =>
    update((draft) => {
      draft.shipment = {
        ...draft.shipment,
        [key]: value,
      } as typeof draft.shipment;
    });
  return (
    <Section title="運送資訊">
      <TextField
        label="原產國"
        onChange={(value) => change("country_of_origin", value)}
        value={document.shipment.country_of_origin}
      />
      <TextField
        label="原產地區"
        onChange={(value) => change("region_of_origin", value)}
        value={document.shipment.region_of_origin}
      />
      <TextField
        label="出口國"
        onChange={(value) => change("country_of_export", value)}
        value={document.shipment.country_of_export}
      />
      <TextField
        label="目的地"
        onChange={(value) => change("destination", value)}
        value={document.shipment.destination}
      />
      <SelectField
        label="運送方式"
        onChange={(value) => change("transport_mode", value)}
        options={["SEA", "AIR"]}
        value={document.shipment.transport_mode}
      />
      <TextField
        label="船舶／航班"
        onChange={(value) => change("vessel", value)}
        value={document.shipment.vessel}
      />
      {document.document_type === "COMMERCIAL_INVOICE" ? (
        <TextField
          label="Incoterm"
          onChange={(value) => change("incoterm", value)}
          value={document.shipment.incoterm}
        />
      ) : null}
    </Section>
  );
}

function IssuerSection({
  issuer,
  onChange,
}: {
  issuer: IssuerDetails;
  onChange: (issuer: IssuerDetails) => void;
}) {
  const change = (key: keyof IssuerDetails, value: string) =>
    onChange({ ...issuer, [key]: value });
  return (
    <Section title="發行人">
      <TextField
        label="組織"
        onChange={(value) => change("organization", value)}
        value={issuer.organization}
      />
      <TextField
        label="授權簽署人"
        onChange={(value) => change("authorized_signatory", value)}
        value={issuer.authorized_signatory}
      />
      <TextField
        label="職稱"
        onChange={(value) => change("role", value)}
        value={issuer.role}
      />
      <TextField
        label="Credential"
        onChange={(value) => change("credential", value)}
        value={issuer.credential}
      />
    </Section>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <fieldset className="rounded-xl border border-border p-4">
      <legend className="px-1 text-sm font-bold">{title}</legend>
      <div className="grid gap-4 pt-1 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function TextField({
  label,
  onChange,
  placeholder,
  required,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <Input
        className="mt-1.5"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}

function NumberField({
  label,
  onChange,
  readOnly,
  value,
}: {
  label: string;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  value: number;
}) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <Input
        className="mt-1.5"
        min="0"
        onChange={(event) => onChange?.(event.target.valueAsNumber || 0)}
        readOnly={readOnly}
        type="number"
        value={value}
      />
    </label>
  );
}

function SelectField({
  label,
  onChange,
  optionLabels,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  optionLabels?: Record<string, string>;
  options: string[];
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <select
        className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

function FixedValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1.5 flex h-10 items-center rounded-lg border border-border bg-muted/50 px-3 font-mono text-sm text-muted-foreground">
        {value}
      </p>
    </div>
  );
}

type Invoice = Extract<ExportDocument, { document_type: "COMMERCIAL_INVOICE" }>;
type PackingList = Extract<ExportDocument, { document_type: "PACKING_LIST" }>;
type DigitalProductPassport = Extract<
  ExportDocument,
  { document_type: "DIGITAL_PRODUCT_PASSPORT" }
>;

function updateInvoice(
  update: UpdateDocument,
  mutate: (draft: Invoice) => void,
) {
  update((draft) => {
    if (draft.document_type === "COMMERCIAL_INVOICE") mutate(draft);
  });
}

function updateInvoiceItem(
  update: UpdateDocument,
  mutate: (item: Invoice["items"][number]) => void,
) {
  updateInvoice(update, (draft) => mutate(draft.items[0]!));
}

function updatePackingList(
  update: UpdateDocument,
  mutate: (draft: PackingList) => void,
) {
  update((draft) => {
    if (draft.document_type === "PACKING_LIST") mutate(draft);
  });
}

function updatePackingCargo(
  update: UpdateDocument,
  mutate: (cargo: PackingList["cargo"][number]) => void,
) {
  updatePackingList(update, (draft) => mutate(draft.cargo[0]!));
}

function updateDigitalProductPassport(
  update: UpdateDocument,
  mutate: (draft: DigitalProductPassport) => void,
) {
  update((draft) => {
    if (draft.document_type === "DIGITAL_PRODUCT_PASSPORT") mutate(draft);
  });
}

function updateDppProduct(
  update: UpdateDocument,
  mutate: (product: DigitalProductPassport["product"]) => void,
) {
  updateDigitalProductPassport(update, (draft) => mutate(draft.product));
}

function updateDppCarbonFootprint(
  update: UpdateDocument,
  mutate: (carbonFootprint: DigitalProductPassport["carbon_footprint"]) => void,
) {
  updateDigitalProductPassport(update, (draft) =>
    mutate(draft.carbon_footprint),
  );
}
