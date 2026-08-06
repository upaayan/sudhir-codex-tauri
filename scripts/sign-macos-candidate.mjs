import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultAppPaths = [
  path.join(
    repositoryRoot,
    "src-tauri",
    "target",
    "aarch64-apple-darwin",
    "release",
    "bundle",
    "macos",
    "Sudhir-Codex Tauri.app",
  ),
  path.join(
    repositoryRoot,
    "src-tauri",
    "target",
    "release",
    "bundle",
    "macos",
    "Sudhir-Codex Tauri.app",
  ),
];
const appPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : defaultAppPaths.find((candidate) => fs.existsSync(candidate));
const secretId = process.env.SUDHIR_CODEX_CODESIGN_SECRET_ID ?? "alamelu/pi-codesign";
const secretRegion = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "ap-south-1";

if (!appPath || !fs.existsSync(appPath)) {
  throw new Error("Tauri macOS candidate is missing; build it before signing");
}

let secretJson = execFileSync(
  "aws",
  [
    "secretsmanager",
    "get-secret-value",
    "--region",
    secretRegion,
    "--secret-id",
    secretId,
    "--query",
    "SecretString",
    "--output",
    "text",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const secret = JSON.parse(secretJson);
secretJson = "";

for (const field of ["keychain_path", "keychain_password", "identity_hash"]) {
  if (typeof secret[field] !== "string" || !secret[field]) {
    throw new Error(`Signing secret is missing ${field}`);
  }
}
if (!fs.existsSync(secret.keychain_path)) {
  throw new Error("Signing keychain path does not exist");
}

runQuiet(
  "security",
  ["unlock-keychain", "-p", secret.keychain_password, secret.keychain_path],
  "keychain unlock",
);
runQuiet(
  "security",
  [
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:,codesign:",
    "-s",
    "-k",
    secret.keychain_password,
    secret.keychain_path,
  ],
  "key partition update",
);

const signingIdentity = secret.identity_hash;
const signingKeychain = secret.keychain_path;
secret.keychain_password = "";
secret.identity_hash = "";

run("codesign", [
  "--force",
  "--deep",
  "--options",
  "runtime",
  "--keychain",
  signingKeychain,
  "--sign",
  signingIdentity,
  "--timestamp=none",
  appPath,
]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

const details = capture("codesign", ["-dv", "--verbose=4", appPath]);
if (!details.includes("Runtime Version")) {
  throw new Error("Signed Tauri candidate does not have hardened runtime");
}
if (details.includes("Signature=adhoc")) {
  throw new Error("Signed Tauri candidate still has an ad-hoc signature");
}
const identifier = capture("/usr/libexec/PlistBuddy", [
  "-c",
  "Print :CFBundleIdentifier",
  path.join(appPath, "Contents", "Info.plist"),
]).trim();
if (identifier !== "com.sudhir.codex.tauri") {
  throw new Error(`Unexpected bundle identifier: ${identifier}`);
}

console.log(`Signed and verified macOS app: ${appPath}`);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

function runQuiet(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || "").trim()}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}
