"use client";

import { FormEvent, type ReactNode, useRef, useState } from "react";

type UploadResponse = {
  error?: string;
  uploaded?: Array<{ originalName: string; path: string }>;
};

export function DocumentUpload({
  orderId,
  onUploaded,
}: {
  orderId: string;
  onUploaded?: () => void;
}): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (files.length === 0) return;

    setUploading(true);
    setResult(undefined);
    const body = new FormData();
    body.set("orderId", orderId);
    files.forEach(file => body.append("files", file));

    try {
      const response = await fetch("/api/documents/upload", { method: "POST", body });
      const data = (await response.json()) as UploadResponse;
      setResult(data);
      if (response.ok) {
        setFiles([]);
        if (inputRef.current) inputRef.current.value = "";
        onUploaded?.();
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
        <div><p className="section-kicker">PREPARE DOCUMENTS</p><h2 id="upload-title">先上傳訂單文件</h2></div>
        <span>目前訂單：{orderId}</span>
      </div>
      <form className="upload-form" onSubmit={submit}>
        <p>不需要選擇文件類型，AI Agent 會依文件內容判斷。</p>
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
        <button disabled={uploading || files.length === 0}>
          {uploading ? "上傳中…" : `上傳 ${files.length} 個檔案`}
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
