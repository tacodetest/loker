import { appendFile } from "node:fs/promises";
import { resolveWorkflowSources } from "./lib/source-filter";

async function main() {
  const sources = resolveWorkflowSources(
    process.env.EVENT_NAME ?? "",
    process.env.INPUT_SOURCE,
    process.env.INPUT_SOURCE_URL,
  );
  const outputs = [
    `run_glints=${String(sources.includes("glints"))}`,
    `run_jobstreet=${String(sources.includes("jobstreet"))}`,
  ].join("\n");
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT tidak tersedia.");
  await appendFile(outputPath, `${outputs}\n`, "utf8");
  console.info(`[workflow] Sumber yang dipilih: ${sources.join(", ")}.`);
}

main().catch((error: unknown) => {
  console.error(`[workflow] Gagal menentukan sumber: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
