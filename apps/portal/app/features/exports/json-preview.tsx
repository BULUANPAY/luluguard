import { Button } from "@luluguard/ui/components/button";
import { Check, Clipboard, Code2 } from "lucide-react";
import { useState } from "react";

import type { ExportObjectPayload } from "./export-object";

export function JsonPreview({ payload }: { payload?: ExportObjectPayload }) {
  const [copied, setCopied] = useState(false);

  if (!payload) {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-2xl border border-dashed border-white/20 bg-white/5 p-8 text-center">
        <div>
          <Code2 className="mx-auto size-10 text-[#d9f99d]/60" />
          <p className="mt-4 font-display text-lg font-bold">等待產生 JSON</p>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-white/55">
            確認左側內容後點擊「產生 JSON 預覽」，資料會在這裡以 API payload 格式呈現。
          </p>
        </div>
      </div>
    );
  }

  const json = JSON.stringify(payload, null, 2);
  const copy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#102b25] shadow-2xl shadow-black/15">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="font-mono text-xs font-bold text-[#d9f99d]">export-object.json</p>
          <p className="mt-0.5 text-[11px] text-white/40">{payload.reference}</p>
        </div>
        <Button className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={copy} size="sm" type="button" variant="outline">
          {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
          {copied ? "已複製" : "複製"}
        </Button>
      </div>
      <pre className="max-h-[720px] overflow-auto p-5 font-mono text-xs leading-6 text-emerald-50">
        <code>{json}</code>
      </pre>
    </div>
  );
}
