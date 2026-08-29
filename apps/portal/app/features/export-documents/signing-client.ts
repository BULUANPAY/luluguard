import type { ExportDocument } from "./export-document";

export const DEMO_SIGNING_LEI = "8755001ELOZEL05BVX22";

export interface SignedExportDocumentEnvelope {
  v: "VLEIJSON-1.0";
  payload: ExportDocument;
  protected: {
    payloadDigest: string;
    lei: string;
    signerAid: string;
    signerCredentialSaid: string;
    signedAt: string;
  };
  signature: string;
  signerId: string;
}

interface SigningApiError {
  error?: {
    code?: string;
    message?: string;
  };
}

export async function signExportDocument(
  document: ExportDocument,
  fetcher: typeof fetch = fetch,
): Promise<SignedExportDocumentEnvelope> {
  const baseUrl = (
    import.meta.env.VITE_VLEI_SIGNING_API_URL ?? "http://localhost:3001"
  ).replace(/\/$/, "");
  const signingLei = import.meta.env.VITE_VLEI_SIGNING_LEI ?? DEMO_SIGNING_LEI;
  const response = await fetcher(`${baseUrl}/api/sign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      signerInfo: {
        organization: document.issuer.organization,
        authorizedSignatory: document.issuer.authorized_signatory,
        role: document.issuer.role,
        credential: document.issuer.credential,
        documentSource: "LuLuGuard exporter workspace",
      },
      // The vLEI sandbox validates ISO 17442 checksums. The document keeps its
      // visibly fictional demo vLEI while the envelope uses this valid demo LEI.
      lei: signingLei,
      payload: document,
    }),
  });

  const body = (await response.json()) as
    SignedExportDocumentEnvelope | SigningApiError;
  if (!response.ok) {
    const apiError = body as SigningApiError;
    throw new Error(
      apiError.error?.message ??
        `vLEI signing API 回傳 HTTP ${response.status}`,
    );
  }

  return body as SignedExportDocumentEnvelope;
}
