import { VleiJsonSigning } from "@repo/vlei-json-signing";

import { createApp } from "./server.js";

const port = Number(process.env.VLEI_SIGNING_API_PORT ?? 3001);

const signing = new VleiJsonSigning();

createApp(signing).listen(port, () => {
  console.log(`vlei-json-signing-api listening on port ${port}`);
});
