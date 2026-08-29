import { Button } from "@luluguard/ui/components/button";
import { Braces, RefreshCw, Send } from "lucide-react";

import type { ExportDocumentType } from "./export-document";

export function ExportDocumentEditor({
  documentType,
  json,
  error,
  isSubmitting,
  onChange,
  onPreview,
  onRegenerate,
  onSubmit,
}: {
  documentType: ExportDocumentType;
  json: string;
  error?: string;
  isSubmitting: boolean;
  onChange: (json: string) => void;
  onPreview: () => void;
  onRegenerate: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary
          label="文件類型"
          value={
            documentType === "COMMERCIAL_INVOICE"
              ? "I/V 商業發票"
              : "P/L 裝箱單"
          }
        />
        <Summary label="格式" value="JSON Body" />
        <Summary label="簽章" value="vLEI JSON" />
      </div>

      <label className="block text-sm font-semibold">
        文件 Body（可直接編輯）
        <textarea
          aria-label="文件 Body"
          className="mt-2 min-h-[620px] w-full resize-y rounded-xl border border-input bg-[#fbfdfc] p-4 font-mono text-xs leading-6 outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15"
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          value={json}
        />
      </label>

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
        <Button
          disabled={isSubmitting}
          onClick={onRegenerate}
          type="button"
          variant="outline"
        >
          <RefreshCw className="size-4" />
          重新隨機產生
        </Button>
        <Button
          disabled={isSubmitting}
          onClick={onPreview}
          type="button"
          variant="outline"
        >
          <Braces className="size-4" />
          更新 JSON 預覽
        </Button>
        <Button disabled={isSubmitting} onClick={onSubmit} type="button">
          <Send className="size-4" />
          {isSubmitting ? "簽章送出中…" : "送出至 vLEI 簽章 API"}
        </Button>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}
