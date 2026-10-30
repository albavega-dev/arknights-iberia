import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const textExtensions = new Set([".cjs", ".css", ".csv", ".html", ".js", ".json", ".md", ".mjs", ".ps1", ".sql", ".scss", ".toml", ".ts", ".tsx", ".txt", ".yml", ".yaml"]);
const excluded = new Set([".git", ".next", "node_modules", ".local-backups", "artifacts", ".playwright-mcp", "coverage"]);
const suspicious = /(?:\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00e2(?:\u0080|\u0082|\u0086|\u0088|\u0080)|\u00f0[\u0090-\u00bf]|\ufffd)/g;

type Finding = { file: string; line: number; text: string; kind: "invalid-utf8" | "mojibake" };

function lineNumber(text: string, offset: number): number { return text.slice(0, offset).split("\n").length; }

async function trackedFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: root });
  return stdout.split("\0").filter(Boolean).filter((file) => textExtensions.has(extname(file).toLowerCase()));
}

async function changedFiles(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--short", "-z"], { cwd: root });
  const files = new Set<string>();
  for (const entry of stdout.split("\0").filter(Boolean)) {
    const file = entry.slice(3).trim();
    if (file && textExtensions.has(extname(file).toLowerCase())) files.add(file);
  }
    return [...files];
  } catch {
    return allTextFiles(root);
  }
}

async function allTextFiles(directory: string, output: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !excluded.has(entry.name)) await allTextFiles(resolve(directory, entry.name), output);
    else if (entry.isFile() && textExtensions.has(extname(entry.name).toLowerCase())) output.push(relative(root, resolve(directory, entry.name)));
  }
  return output;
}

async function inspect(file: string): Promise<Finding[]> {
  const fullPath = resolve(root, file);
  const bytes = await readFile(fullPath);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return [{ file, line: 1, text: "El archivo no contiene UTF-8 válido", kind: "invalid-utf8" }]; }
  const findings: Finding[] = [];
  for (const match of text.matchAll(suspicious)) {
    const offset = match.index ?? 0;
    const line = text.slice(text.lastIndexOf("\n", offset - 1) + 1, text.indexOf("\n", offset) === -1 ? text.length : text.indexOf("\n", offset)).trim();
    findings.push({ file, line: lineNumber(text, offset), text: line, kind: "mojibake" });
  }
  return findings;
}

async function selfTest(): Promise<void> {
  const valid = ["Ilustración", "Despliegue", "España", "¿Qué?", "明日方舟", "アークナイツ", "Surtr — 灰喉"];
  const invalid = ["Ilustraci" + String.fromCodePoint(0xc3, 0xb3) + "n", "Espa" + String.fromCodePoint(0xc3, 0xb1) + "a"];
  const detects = (value: string): boolean => new RegExp(suspicious.source).test(value);
  if (valid.some(detects) || invalid.some((value) => !detects(value))) throw new Error("El auto-test de detección de mojibake ha fallado");
  console.log(`Encoding self-test passed: ${valid.length} Unicode samples accepted; ${invalid.length} mojibake samples detected.`);
}

const args = new Set(process.argv.slice(2));
if (args.has("--self-test")) await selfTest();
else {
  const files = args.has("--all") ? await allTextFiles(root) : args.has("--changed") ? await changedFiles() : await trackedFiles();
  const findings = (await Promise.all(files.map(inspect))).flat();
  for (const finding of findings) console.error(`${finding.kind}: ${finding.file}:${finding.line}: ${finding.text}`);
  if (findings.length) process.exitCode = 1;
  else console.log(`Encoding check passed: ${files.length} text file(s), UTF-8 valid, no suspicious mojibake.`);
}
