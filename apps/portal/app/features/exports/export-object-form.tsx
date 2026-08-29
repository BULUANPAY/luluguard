import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@luluguard/ui/components/button";
import { Input } from "@luluguard/ui/components/input";
import { Braces, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";

import {
  createRandomExportGoodsItem,
  exportObjectFormSchema,
  type ExportObjectFormValues,
} from "./export-object";

export function ExportObjectForm({
  initialValues,
  onPreview,
  onRegenerate,
  onSubmit: onSubmitValues,
  isSubmitting = false,
}: {
  initialValues: ExportObjectFormValues;
  onPreview: (values: ExportObjectFormValues) => void;
  onRegenerate: () => void;
  onSubmit: (values: ExportObjectFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ExportObjectFormValues>({
    resolver: zodResolver(exportObjectFormSchema),
    defaultValues: initialValues,
  });
  const { append, fields, remove } = useFieldArray({
    control,
    name: "goods",
  });

  return (
    <form
      className="space-y-7"
      onSubmit={handleSubmit((values) => onPreview(values))}
    >
      <FormSection
        description="識別這一筆出口資料與交易雙方。"
        title="基本資料"
      >
        <Field error={errors.reference?.message} label="出口物件編號">
          <Input {...register("reference")} />
        </Field>
        <Field error={errors.exporterCompany?.message} label="出口商">
          <Input {...register("exporterCompany")} />
        </Field>
        <Field error={errors.consigneeName?.message} label="收貨人">
          <Input {...register("consigneeName")} />
        </Field>
        <Field error={errors.consigneeCountry?.message} label="收貨人國家代碼">
          <Input maxLength={2} {...register("consigneeCountry")} />
        </Field>
      </FormSection>

      <FormSection
        description="發票條件與申報金額。"
        title="商業資訊"
      >
        <Field error={errors.invoiceNo?.message} label="商業發票號碼">
          <Input {...register("invoiceNo")} />
        </Field>
        <Field error={errors.incoterm?.message} label="貿易條件">
          <select className={selectClassName} {...register("incoterm")}>
            {['EXW', 'FOB', 'CIF', 'CPT', 'DAP', 'DDP'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field error={errors.currency?.message} label="幣別">
          <select className={selectClassName} {...register("currency")}>
            {['USD', 'TWD', 'JPY'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field error={errors.totalValue?.message} label="發票總額">
          <Input min="0" step="0.01" type="number" {...register("totalValue", { valueAsNumber: true })} />
        </Field>
      </FormSection>

      <FormSection
        description="安排這一筆出口物件的運送方式與日期。"
        title="運送資訊"
      >
        <Field error={errors.originCountry?.message} label="原產國代碼">
          <Input maxLength={2} {...register("originCountry")} />
        </Field>
        <Field error={errors.destinationPort?.message} label="目的港">
          <Input {...register("destinationPort")} />
        </Field>
        <Field error={errors.transportMode?.message} label="運輸方式">
          <select className={selectClassName} {...register("transportMode")}>
            <option value="sea">海運</option>
            <option value="air">空運</option>
            <option value="road">陸運</option>
          </select>
        </Field>
        <Field error={errors.plannedDepartureDate?.message} label="預計出貨日">
          <Input type="date" {...register("plannedDepartureDate")} />
        </Field>
      </FormSection>

      <fieldset>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <legend className="font-display text-base font-bold">
              貨物明細（{fields.length}）
            </legend>
            <p className="mt-1 text-sm text-muted-foreground">
              每項貨物分別填寫申報內容、件數與重量。
            </p>
          </div>
          <Button
            onClick={() => append(createRandomExportGoodsItem())}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus className="size-4" />
            新增貨物
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          {fields.map((field, index) => (
            <div
              className="rounded-xl border border-border bg-muted/20 p-4"
              key={field.id}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="font-display text-sm font-bold">貨物 {index + 1}</p>
                <Button
                  aria-label={`移除貨物 ${index + 1}`}
                  disabled={fields.length === 1}
                  onClick={() => remove(index)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  className="md:col-span-2"
                  error={errors.goods?.[index]?.description?.message}
                  label="貨物描述"
                >
                  <textarea
                    className={`${selectClassName} min-h-24 py-2.5`}
                    {...register(`goods.${index}.description`)}
                  />
                </Field>
                <Field
                  error={errors.goods?.[index]?.hsCode?.message}
                  label="稅則號列（HS Code）"
                >
                  <Input
                    inputMode="numeric"
                    {...register(`goods.${index}.hsCode`)}
                  />
                </Field>
                <Field
                  error={errors.goods?.[index]?.packageCount?.message}
                  label="包裝件數"
                >
                  <Input
                    min="1"
                    type="number"
                    {...register(`goods.${index}.packageCount`, {
                      valueAsNumber: true,
                    })}
                  />
                </Field>
                <Field
                  error={errors.goods?.[index]?.grossWeightKg?.message}
                  label="毛重（kg）"
                >
                  <Input
                    min="0"
                    step="0.01"
                    type="number"
                    {...register(`goods.${index}.grossWeightKg`, {
                      valueAsNumber: true,
                    })}
                  />
                </Field>
                <label className="flex min-h-10 items-center gap-3 self-end rounded-lg border border-border bg-background px-3 text-sm font-medium">
                  <input
                    className="size-4 accent-primary"
                    type="checkbox"
                    {...register(`goods.${index}.dangerousGoods`)}
                  />
                  危險品
                </label>
              </div>
            </div>
          ))}
        </div>
        {errors.goods?.root?.message ? (
          <p className="mt-2 text-xs font-medium text-red-600">
            {errors.goods.root.message}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
        <Button onClick={onRegenerate} type="button" variant="outline">
          <RefreshCw className="size-4" />
          重新隨機產生
        </Button>
        <Button type="submit" variant="outline">
          <Braces className="size-4" />
          產生 JSON 預覽
        </Button>
        <Button
          disabled={isSubmitting}
          onClick={handleSubmit((values) => onSubmitValues(values))}
          type="button"
        >
          <Send className="size-4" />
          {isSubmitting ? "送出中…" : "送出出口物件"}
        </Button>
      </div>
    </form>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="font-display text-base font-bold">{title}</legend>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  error,
  className = "",
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-sm font-semibold ${className}`}>
      <span>{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : null}
    </label>
  );
}

const selectClassName =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15";
