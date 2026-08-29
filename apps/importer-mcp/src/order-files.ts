import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const safeSegmentPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;

export type OrderFile = {
  documentType: string;
  filename: string;
  path: string;
  size: number;
  content: unknown;
};

function assertSafeSegment(value: string, label: string) {
  if (!safeSegmentPattern.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, hyphens, or underscores`);
  }
}

export async function getOrderFiles(
  storageRoot: string,
  orderId: string,
  requestedTypes?: string[]
): Promise<OrderFile[]> {
  assertSafeSegment(orderId, "orderId");
  requestedTypes?.forEach(type => assertSafeSegment(type, "documentType"));

  const orderDirectory = path.join(storageRoot, orderId);
  const availableTypes = await readdir(orderDirectory, { withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const allowedTypes = new Set(requestedTypes);
  const documentTypes = availableTypes
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && safeSegmentPattern.test(entry.name))
    .map(entry => entry.name)
    .filter(type => !requestedTypes || allowedTypes.has(type))
    .sort();

  const files: OrderFile[] = [];
  let totalSize = 0;
  for (const documentType of documentTypes) {
    const typeDirectory = path.join(orderDirectory, documentType);
    const entries = await readdir(typeDirectory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || entry.isSymbolicLink() || entry.name.startsWith(".") || path.extname(entry.name).toLowerCase() !== ".json") continue;

      const absolutePath = path.join(typeDirectory, entry.name);
      const fileStat = await stat(absolutePath);
      if (fileStat.size > MAX_FILE_SIZE) throw new Error(`${entry.name} exceeds the 5 MB file limit`);
      totalSize += fileStat.size;
      if (totalSize > MAX_TOTAL_SIZE) throw new Error("Order files exceed the 20 MB total read limit");

      const text = await readFile(absolutePath, "utf8");
      let content: unknown;
      try {
        content = JSON.parse(text);
      } catch {
        throw new Error(`${entry.name} contains invalid JSON`);
      }
      files.push({
        documentType,
        filename: entry.name,
        path: path.posix.join("uploaded-files", orderId, documentType, entry.name),
        size: fileStat.size,
        content
      });
    }
  }
  return files;
}
