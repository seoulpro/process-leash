import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

spawn(process.execPath, [fileURLToPath(new URL("./ignore-term.mjs", import.meta.url))], {
  stdio: "ignore",
});
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
