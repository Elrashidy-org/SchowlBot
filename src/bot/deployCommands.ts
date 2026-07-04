import "dotenv/config";
import { REST, Routes } from "discord.js";
import { slashCommands } from "./commands.js";
import { config } from "../config.js";

// Usage:
//   npm run commands:deploy            -> global deploy (all servers; may take up to ~1h to appear)
//   npm run commands:deploy -- --guild -> instant deploy to DISCORD_GUILD_ID (for fast testing)
const guildMode = process.argv.includes("--guild");

if (!config.discordToken || !config.discordClientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");
}
if (guildMode && !config.discordGuildId) {
  throw new Error("DISCORD_GUILD_ID is required for --guild deploys");
}

const rest = new REST({ version: "10" }).setToken(config.discordToken);

if (guildMode) {
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    { body: slashCommands },
  );
  console.log(`Deployed ${slashCommands.length} SchowlBot commands to guild ${config.discordGuildId}`);
} else {
  await rest.put(Routes.applicationCommands(config.discordClientId), { body: slashCommands });
  console.log(`Deployed ${slashCommands.length} SchowlBot commands globally`);
}
