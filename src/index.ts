import { startDiscordBot } from "./bot/discordService.js";
import { startHttpServer } from "./http/server.js";
import { startAutomationWorker, stopAutomationWorker } from "./services/workerService.js";

const server = startHttpServer();
await startDiscordBot();
startAutomationWorker();

function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down SchowlBot`);
  stopAutomationWorker();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
