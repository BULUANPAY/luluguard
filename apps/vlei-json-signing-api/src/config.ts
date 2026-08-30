export const DEFAULT_SIGNING_API_PORT = 3001;

export function parseSigningApiPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SIGNING_API_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      "VLEI_SIGNING_API_PORT must be an integer between 1 and 65535",
    );
  }
  return port;
}
