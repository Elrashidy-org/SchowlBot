import "dotenv/config";
import { REST, Routes } from "discord.js";
import { slashCommands } from "./commands.js";
import { config } from "../config.js";

if (!config.discordToken || !config.discordClientId || !config.discordGuildId) {
  throw new Error("DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID are required");
}

const rest = new REST({ version: "10" }).setToken(config.discordToken);

await rest.put(
  Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
  { body: slashCommands },
);

console.log(`Deployed ${slashCommands.length} SchowlBot commands`);
