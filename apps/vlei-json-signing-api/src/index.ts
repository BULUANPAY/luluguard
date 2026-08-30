import { VleiJsonSigning } from "@repo/vlei-json-signing";

import { parseSigningApiPort } from "./config.js";
import { createApp } from "./server.js";

const port = parseSigningApiPort(process.env.VLEI_SIGNING_API_PORT);

const signing = new VleiJsonSigning();

createApp(signing).listen(port, () => {
  console.log(`vlei-json-signing-api listening on port ${port}`);
});
