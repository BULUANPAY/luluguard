import { Badge } from "@luluguard/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@luluguard/ui/components/card";
import { createExportObject } from "@luluguard/api-client";
import { ArrowLeft, Dices, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { useSession } from "../features/auth/session-context";
import {
  buildExportObjectPayload,
  createRandomExportObject,
  type ExportObjectPayload,
} from "../features/exports/export-object";
import { ExportObjectForm } from "../features/exports/export-object-form";
import { JsonPreview } from "../features/exports/json-preview";

export function meta() {
  return [{ title: "新增出口物件｜LuLuGuard" }];
}

export default function NewExportObjectRoute() {
  const { session } = useSession();

  if (session.activeOrganization.kind !== "exporter") {
    return <ExporterOnly />;
  }

  return (
    <ExportObjectWorkspace
      exporterCompany={session.activeOrganization.name}
      key={session.activeOrganization.id}
    />
  );
}

function ExportObjectWorkspace({ exporterCompany }: { exporterCompany: string }) {
  const [draftVersion, setDraftVersion] = useState(0);
  const [initialValues, setInitialValues] = useState(() =>
    createRandomExportObject(exporterCompany),
  );
  const [preview, setPreview] = useState<ExportObjectPayload>();
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [submittedReference, setSubmittedReference] = useState<string>();

  const regenerate = () => {
    setInitialValues(createRandomExportObject(exporterCompany));
    setDraftVersion((version) => version + 1);
    setPreview(undefined);
    setSubmitState("idle");
    setSubmittedReference(undefined);
  };

  const submit = async (values: Parameters<typeof buildExportObjectPayload>[0]) => {
    const payload = buildExportObjectPayload(values);
    setPreview(payload);
    setSubmitState("submitting");
    setSubmittedReference(undefined);

    try {
      const result = await createExportObject(payload);
      setSubmitState(result.accepted ? "success" : "error");
      setSubmittedReference(result.reference);
    } catch {
      setSubmitState("error");
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <Link className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground" to="/">
        <ArrowLeft className="size-4" />
        返回總覽
      </Link>

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge className="border-primary/15 bg-primary/5 text-primary">出口商專用</Badge>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">新增出口物件</h1>
          <p className="mt-1 text-sm text-muted-foreground">系統已隨機預填一組示範資料，你可以直接修改或重新產生。</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-white/70 px-4 py-2 text-sm text-muted-foreground shadow-sm">
          <Dices className="size-4 text-primary" />
          第 {draftVersion + 1} 組隨機草稿
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>出口資料填單</CardTitle>
            <CardDescription>送出前仍可修改；送出時會先驗證資料並提交目前的 JSON payload。</CardDescription>
          </CardHeader>
          <CardContent>
            <ExportObjectForm
              initialValues={initialValues}
              isSubmitting={submitState === "submitting"}
              key={draftVersion}
              onPreview={(values) => setPreview(buildExportObjectPayload(values))}
              onRegenerate={regenerate}
              onSubmit={submit}
            />
            {submitState === "success" ? (
              <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800" role="status">
                已送出 {submittedReference}，本機 API 已接受這筆出口物件。
              </p>
            ) : null}
            {submitState === "error" ? (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700" role="alert">
                送出失敗，請確認資料後再試一次。
              </p>
            ) : null}
          </CardContent>
        </Card>

        <aside className="rounded-2xl bg-[#173c34] p-4 text-white xl:sticky xl:top-24">
          <div className="mb-4 px-1">
            <p className="font-display text-lg font-bold">JSON 預覽</p>
            <p className="mt-1 text-sm text-white/50">可直接複製並提供給後端或 API 測試。</p>
          </div>
          <JsonPreview payload={preview} />
        </aside>
      </div>
    </div>
  );
}

function ExporterOnly() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <LockKeyhole className="mx-auto size-9 text-muted-foreground" />
        <h1 className="mt-4 font-display text-xl font-bold">此功能僅供出口商使用</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">請先從右上角公司選單切換到出口商，再建立出口物件。</p>
        <Link className="mt-5 inline-flex text-sm font-semibold text-primary hover:underline" to="/">返回總覽</Link>
      </div>
    </div>
  );
}
