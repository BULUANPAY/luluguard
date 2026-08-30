import { config } from "./config.js";
import { createApp } from "./app.js";
import { createLogger } from "./logger.js";

const log = createLogger(config);
const { app } = createApp({ config });

app.listen(config.port, config.host, () => {
  log("info", "server.started", {
    url: `http://${config.host}:${config.port}`,
    network: config.network,
    facilitatorUrl: config.facilitatorUrl
  });
});
