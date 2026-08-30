import { Badge } from "@luluguard/ui/components/badge";
import { Button } from "@luluguard/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@luluguard/ui/components/card";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { useSession } from "../features/auth/session-context";
import { JsonPreview } from "../features/exports/json-preview";
import { ExportDocumentEditor } from "../features/export-documents/export-document-editor";
import {
  createEmptyExportDocument,
  createTestExportDocument,
  parseExportDocument,
  type ExportDocumentType,
} from "../features/export-documents/export-document";
import { downloadSignedResponse } from "../features/export-documents/response-download";
import {
  DEFAULT_SIGNING_LEI,
  signExportDocument,
  type SignedExportDocumentEnvelope,
  type SigningIdentity,
} from "../features/export-documents/signing-client";
import { SigningIdentityDialog } from "../features/export-documents/signing-identity-dialog";

export function meta() {
  return [{ title: "產生出口文件｜LuLuGuard" }];
}

type SubmitState = "idle" | "submitting" | "success" | "error";

export default function NewExportDocumentRoute() {
  const { session } = useSession();

  if (session.activeOrganization.kind !== "exporter") {
    return <ExporterOnly />;
  }

  return (
    <ExportDocumentWorkspace
      exporterCompany={session.activeOrganization.name}
      key={session.activeOrganization.id}
    />
  );
}

function ExportDocumentWorkspace({
  exporterCompany,
}: {
  exporterCompany: string;
}) {
  const [documentType, setDocumentType] =
    useState<ExportDocumentType>("COMMERCIAL_INVOICE");
  const [document, setDocument] = useState(() =>
    createEmptyExportDocument(documentType, exporterCompany),
  );
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string>();
  const [envelope, setEnvelope] = useState<SignedExportDocumentEnvelope>();
  const [isSignDialogOpen, setIsSignDialogOpen] = useState(false);

  const switchDocumentType = (nextType: ExportDocumentType) => {
    const nextDocument = createEmptyExportDocument(nextType, exporterCompany);
    setDocumentType(nextType);
    setDocument(nextDocument);
    setSubmitState("idle");
    setError(undefined);
    setEnvelope(undefined);
  };

  const submit = async (identity: SigningIdentity) => {
    setSubmitState("submitting");
    setEnvelope(undefined);
    try {
      const currentDocument = parseExportDocument(
        JSON.stringify(document),
        documentType,
      );
      setError(undefined);
      const result = await signExportDocument(currentDocument, identity);
      setEnvelope(result);
      setSubmitState("success");
      downloadSignedResponse(result);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "送出失敗，請稍後再試。",
      );
      setSubmitState("error");
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <Link
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        to="/"
      >
        <ArrowLeft className="size-4" />
        返回總覽
      </Link>

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge className="border-primary/15 bg-primary/5 text-primary">
            出口商專用
          </Badge>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            產生出口文件
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            在左側填寫固定格式的 I/V、P/L 或 DPP，右側會即時產生
            JSON，確認後可送至 vLEI JSON signing API。
          </p>
        </div>
      </section>

      <div
        className="inline-flex rounded-xl border border-border bg-white p-1 shadow-sm"
        aria-label="文件類型"
      >
        <DocumentTypeButton
          active={documentType === "COMMERCIAL_INVOICE"}
          label="I/V 商業發票"
          onClick={() => switchDocumentType("COMMERCIAL_INVOICE")}
        />
        <DocumentTypeButton
          active={documentType === "PACKING_LIST"}
          label="P/L 裝箱單"
          onClick={() => switchDocumentType("PACKING_LIST")}
        />
        <DocumentTypeButton
          active={documentType === "DIGITAL_PRODUCT_PASSPORT"}
          label="DPP 數位產品護照"
          onClick={() => switchDocumentType("DIGITAL_PRODUCT_PASSPORT")}
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              {documentType === "COMMERCIAL_INVOICE"
                ? "I/V 商業發票"
                : documentType === "PACKING_LIST"
                  ? "P/L 裝箱單"
                  : "DPP 數位產品護照"}
            </CardTitle>
            <CardDescription>
              依固定欄位填寫文件內容，也可載入一組固定測試資料。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExportDocumentEditor
              document={document}
              error={error}
              isSubmitting={submitState === "submitting"}
              onChange={(value) => {
                setDocument(value);
                setSubmitState("idle");
                setError(undefined);
                setEnvelope(undefined);
              }}
              onSubmit={() => setIsSignDialogOpen(true)}
              onUseTestData={() => {
                setDocument(
                  createTestExportDocument(documentType, exporterCompany),
                );
                setSubmitState("idle");
                setError(undefined);
                setEnvelope(undefined);
              }}
            />

            {isSignDialogOpen ? (
              <SigningIdentityDialog
                defaultValues={{
                  lei: DEFAULT_SIGNING_LEI,
                  signer: document.issuer.authorized_signatory,
                  role: document.issuer.role,
                }}
                isSubmitting={submitState === "submitting"}
                onCancel={() => setIsSignDialogOpen(false)}
                onConfirm={(identity) => {
                  setIsSignDialogOpen(false);
                  void submit(identity);
                }}
              />
            ) : null}

            {submitState === "success" && envelope ? (
              <div
                className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
                role="status"
              >
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="size-4" />
                  文件已完成 vLEI JSON 簽章，回應已下載
                </div>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <ResultItem label="Signer ID" value={envelope.signerId} />
                  <ResultItem
                    label="Signer AID"
                    value={envelope.protected.signerAid}
                  />
                  <ResultItem
                    label="Payload digest"
                    value={envelope.protected.payloadDigest}
                  />
                  <ResultItem
                    label="Signed at"
                    value={envelope.protected.signedAt}
                  />
                </dl>
                <Button
                  className="mt-4 border-emerald-300 bg-white/60 text-emerald-900 hover:bg-white"
                  onClick={() => downloadSignedResponse(envelope)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Download className="size-4" />
                  再次下載 JSON
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <aside className="rounded-2xl bg-[#173c34] p-4 text-white xl:sticky xl:top-24">
          <div className="mb-4 flex items-start justify-between gap-3 px-1">
            <div>
              <p className="font-display text-lg font-bold">JSON 預覽</p>
              <p className="mt-1 text-sm text-white/50">
                表單修改後自動更新；送出時會將此文件放入 signing API payload。
              </p>
            </div>
            <ShieldCheck className="mt-1 size-5 text-[#d9f99d]" />
          </div>
          <JsonPreview
            fileName={
              documentType === "COMMERCIAL_INVOICE"
                ? "commercial-invoice.json"
                : documentType === "PACKING_LIST"
                  ? "packing-list.json"
                  : "digital-product-passport.json"
            }
            payload={document}
          />
        </aside>
      </div>
    </div>
  );
}

function DocumentTypeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-pressed={active}
      className={active ? "shadow-sm" : "text-muted-foreground"}
      onClick={onClick}
      size="sm"
      type="button"
      variant={active ? "default" : "ghost"}
    >
      <FileText className="size-4" />
      {label}
    </Button>
  );
}

function ResultItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-semibold text-emerald-700">{label}</dt>
      <dd className="mt-0.5 truncate font-mono" title={value}>
        {value}
      </dd>
    </div>
  );
}

function ExporterOnly() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <LockKeyhole className="mx-auto size-9 text-muted-foreground" />
        <h1 className="mt-4 font-display text-xl font-bold">
          此功能僅供出口商使用
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          請先從右上角公司選單切換到出口商，再產生 I/V、P/L 或 DPP 文件。
        </p>
        <Link
          className="mt-5 inline-flex text-sm font-semibold text-primary hover:underline"
          to="/"
        >
          返回總覽
        </Link>
      </div>
    </div>
  );
}
