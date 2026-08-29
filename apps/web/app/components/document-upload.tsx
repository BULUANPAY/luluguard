"use client";

import { FormEvent, type ReactNode, useRef, useState } from "react";

const defaultDocumentTypes = [
  { value: "commercial_invoice", label: "商業發票" },
  { value: "packing_list", label: "裝箱單" },
  { value: "bill_of_lading", label: "海運提單" },
  { value: "certificate_of_origin", label: "產地證明" },
  { value: "product_specification", label: "產品規格書" },
  { value: "import_permit", label: "輸入許可證" }
] as const;

type UploadResponse = {
  error?: string;
  uploaded?: Array<{ originalName: string; path: string }>;
};

export function DocumentUpload({ orderId }: { orderId: string }): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState(defaultDocumentTypes[0].value as string);
  const [customType, setCustomType] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse>();

  const resolvedType = documentType === "custom" ? customType.trim() : documentType;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!resolvedType || files.length === 0) return;

    setUploading(true);
    setResult(undefined);
    const body = new FormData();
    body.set("orderId", orderId);
    body.set("documentType", resolvedType);
    files.forEach(file => body.append("files", file));

    try {
      const response = await fetch("/api/documents/upload", { method: "POST", body });
      const data = (await response.json()) as UploadResponse;
      setResult(data);
      if (response.ok) {
        setFiles([]);
        if (inputRef.current) inputRef.current.value = "";
      }
    } catch {
      setResult({ error: "無法連線到上傳服務，請稍後再試。" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="upload-panel" aria-labelledby="upload-title">
      <div className="documents-heading">
        <div><p className="section-kicker">JSON UPLOAD</p><h2 id="upload-title">上傳訂單文件</h2></div>
        <span>目前訂單：{orderId}</span>
      </div>
      <form className="upload-form" onSubmit={submit}>
        <label>
          文件類型
          <select value={documentType} onChange={event => { setDocumentType(event.target.value); setResult(undefined); }}>
            {defaultDocumentTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            <option value="custom">自訂類型</option>
          </select>
        </label>
        {documentType === "custom" && (
          <label>
            自訂類型代碼
            <input value={customType} onChange={event => setCustomType(event.target.value)} placeholder="例如：insurance_policy" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}" required />
          </label>
        )}
        <label className="file-picker">
          JSON 檔案（最多 20 個，每個 5 MB）
          <input ref={inputRef} type="file" accept="application/json,.json" multiple required
            onChange={event => { setFiles(Array.from(event.target.files ?? [])); setResult(undefined); }} />
        </label>
        {files.length > 0 && (
          <ul className="selected-files">
            {files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><small>{(file.size / 1024).toFixed(1)} KB</small></li>)}
          </ul>
        )}
        <button disabled={uploading || !resolvedType || files.length === 0}>
          {uploading ? "上傳中…" : `上傳 ${files.length || ""} 個檔案`}
        </button>
      </form>
      {result?.error && <p className="upload-result error" role="alert">{result.error}</p>}
      {result?.uploaded && (
        <div className="upload-result success" role="status">
          <strong>已成功儲存 {result.uploaded.length} 個檔案</strong>
          <ul>{result.uploaded.map(file => <li key={file.path}>{file.originalName}<small>{file.path}</small></li>)}</ul>
        </div>
      )}
    </section>
  );
}
