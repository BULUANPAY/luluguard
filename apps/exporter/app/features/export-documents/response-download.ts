import type { SignedExportDocumentEnvelope } from "./signing-client";

export function buildSignedResponseFileName(
  envelope: SignedExportDocumentEnvelope,
) {
  const documentType = envelope.payload.document_type;
  const documentId = sanitizeFileNamePart(
    envelope.payload.document_id,
    "unnumbered",
  );

  return `${documentType}_${documentId}.json`;
}

export function downloadSignedResponse(envelope: SignedExportDocumentEnvelope) {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = buildSignedResponseFileName(envelope);
  anchor.click();
  URL.revokeObjectURL(url);
}

function sanitizeFileNamePart(value: string, fallback: string) {
  const sanitized = Array.from(value.trim(), (character) =>
    character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character)
      ? "-"
      : character,
  )
    .join("")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/^[. ]+|[. ]+$/g, "");

  return sanitized || fallback;
}
