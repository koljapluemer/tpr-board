import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const rootDir = "public";

async function collectJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return collectJsonFiles(entryPath);
      }

      if (entry.isFile() && entry.name.endsWith(".json")) {
        return [entryPath];
      }

      return [];
    }),
  );

  return files.flat().sort();
}

async function main() {
  let jsonFiles;

  try {
    jsonFiles = await collectJsonFiles(rootDir);
  } catch (error) {
    console.error(`Failed to read ${rootDir}:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }

  if (jsonFiles.length === 0) {
    console.log(`No JSON files found under ${rootDir}`);
    return;
  }

  let invalidCount = 0;

  for (const filePath of jsonFiles) {
    try {
      const contents = await readFile(filePath, "utf8");
      JSON.parse(contents);
    } catch (error) {
      invalidCount += 1;
      console.error(`Invalid JSON: ${filePath}`);

      if (error instanceof Error) {
        console.error(`  ${error.message}`);
      }
    }
  }

  if (invalidCount > 0) {
    process.exit(1);
  }

  console.log(`Validated ${jsonFiles.length} JSON file(s) under ${rootDir}`);
}

await main();
