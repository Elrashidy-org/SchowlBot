import { config } from "../config.js";
import { createHttpApp } from "./app.js";

export function startHttpServer() {
  const app = createHttpApp();
  const server = app.listen(config.port, () => {
    console.log(`SchowlBot API listening on port ${config.port}`);
  });
  return server;
}
