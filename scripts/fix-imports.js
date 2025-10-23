#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { glob } from "glob";

const files = glob.sync("dist/**/*.js");

files.forEach((file) => {
  let content = readFileSync(file, "utf8");

  // Add .js to relative imports without extensions
  content = content.replace(
    /from ['"](\.\.[\/\\][^'"]+?)(?<!\.js)['"]/g,
    'from "$1.js"'
  );
  content = content.replace(
    /from ['"](\.[\/\\][^'"]+?)(?<!\.js)['"]/g,
    'from "$1.js"'
  );

  // Add .js to dynamic imports without extensions
  content = content.replace(
    /import\(['"](\.\.[\/\\][^'"]+?)(?<!\.js)['"]\)/g,
    'import("$1.js")'
  );
  content = content.replace(
    /import\(['"](\.[\/\\][^'"]+?)(?<!\.js)['"]\)/g,
    'import("$1.js")'
  );

  writeFileSync(file, content);
});

console.log(`Fixed ${files.length} files`);
