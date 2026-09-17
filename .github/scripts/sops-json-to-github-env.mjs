// Turn `sops -d --output-type json <file>` on stdin into GITHUB_ENV entries.
// Values are written with heredoc syntax because the App Store Connect .p8 key
// is multi-line, and nothing is ever echoed to stdout.
import { appendFileSync } from "node:fs";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const secrets = JSON.parse(Buffer.concat(chunks).toString("utf8"));

const envFile = process.env.GITHUB_ENV;
if (!envFile) {
  console.error("GITHUB_ENV is not set");
  process.exit(1);
}

const names = [];
for (const [key, value] of Object.entries(secrets)) {
  if (key === "sops" || value === null || value === undefined) {
    continue;
  }
  const text = String(value);
  if (text.includes("\n")) {
    appendFileSync(envFile, `${key}<<__EOF__\n${text}\n__EOF__\n`);
  } else {
    appendFileSync(envFile, `${key}=${text}\n`);
  }
  names.push(key);
}

console.log(`Loaded ${names.length} values: ${names.sort().join(", ")}`);
