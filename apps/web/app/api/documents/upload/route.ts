import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { sessionFromRequest } from "../../../../lib/sandbox-auth";
import documentTypes from "../../../example-document-types.json";

export const runtime = "nodejs";

const MAX_FILES = 20;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const safeSegmentPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function safeFilename(filename: string) {
  const base = path.basename(filename, path.extname(filename));
  const sanitized = base.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${sanitized || "document"}-${randomUUID()}.json`;
}

export async function POST(request: Request) {
  if (!sessionFromRequest(request)) {
    return NextResponse.json(
      { error: "請先登入員工帳號。" },
      { status: 401 },
    );
  }

  try {
    const formData = await request.formData();
    const orderId = String(formData.get("orderId") ?? "").trim();
    const documentType = String(formData.get("documentType") ?? "").trim();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);

    if (!safeSegmentPattern.test(orderId)) {
      return NextResponse.json({ error: "訂單編號格式不正確。" }, { status: 400 });
    }
    if (!safeSegmentPattern.test(documentType) || !documentTypes.some(candidate => candidate.type === documentType)) {
      return NextResponse.json({ error: "不支援此文件類型。" }, { status: 400 });
    }
    if (files.length === 0 || files.length > MAX_FILES) {
      return NextResponse.json({ error: `請選擇 1 至 ${MAX_FILES} 個 JSON 檔案。` }, { status: 400 });
    }

    const validatedFiles: Array<{ file: File; contents: Uint8Array }> = [];
    for (const file of files) {
      if (path.extname(file.name).toLowerCase() !== ".json") {
        return NextResponse.json({ error: `${file.name} 不是 JSON 檔案。` }, { status: 400 });
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `${file.name} 超過 5 MB 上限。` }, { status: 400 });
      }

      const text = await file.text();
      try {
        JSON.parse(text);
      } catch {
        return NextResponse.json({ error: `${file.name} 的 JSON 格式無效。` }, { status: 400 });
      }
      validatedFiles.push({ file, contents: new TextEncoder().encode(text) });
    }

    const repositoryRoot = path.resolve(process.cwd(), "../..");
    const targetDirectory = path.join(repositoryRoot, "uploaded-files", orderId, documentType);
    await mkdir(targetDirectory, { recursive: true });

    const uploaded = [];
    for (const { file, contents } of validatedFiles) {
      const storedName = safeFilename(file.name);
      await writeFile(path.join(targetDirectory, storedName), contents, { flag: "wx" });
      uploaded.push({
        originalName: file.name,
        storedName,
        size: file.size,
        path: path.posix.join("uploaded-files", orderId, documentType, storedName)
      });
    }

    return NextResponse.json({ orderId, documentType, uploaded }, { status: 201 });
  } catch (error) {
    console.error("Document upload failed", error);
    return NextResponse.json({ error: "文件儲存失敗，請稍後再試。" }, { status: 500 });
  }
}
