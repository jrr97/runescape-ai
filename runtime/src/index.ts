import { loadConfig } from "./config.js";
import { createRuntimeServer } from "./server.js";

const config = await loadConfig();
const { server } = await createRuntimeServer(config);
server.listen(config.port, "0.0.0.0", () => {
  console.log(`RuneScape runtime listening on :${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
