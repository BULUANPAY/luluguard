import { defineConfig } from "orval";

export default defineConfig({
  luluguard: {
    input: {
      target: "./openapi/luluguard.yaml",
    },
    output: {
      mode: "single",
      target: "./src/generated/luluguard.ts",
      schemas: "./src/generated/models",
      client: "react-query",
      httpClient: "fetch",
      clean: true,
      override: {
        mutator: {
          path: "./src/http-client.ts",
          name: "apiFetch",
        },
        fetch: {
          includeHttpResponseReturnType: false,
        },
        query: {
          signal: true,
        },
      },
    },
  },
});
