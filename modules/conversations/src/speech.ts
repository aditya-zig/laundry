import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const ALLOWED_MIME = new Set(["audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/aac", "audio/3gpp", "audio/opus", "audio/x-wav"]);

const MIME_SUFFIX: Record<string, string> = {
  "audio/ogg": ".ogg",
  "audio/opus": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/aac": ".aac",
  "audio/3gpp": ".3gp",
};

function suffixForMime(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return MIME_SUFFIX[base] ?? ".wav";
}

function extraArgv(): string[] {
  // Prefer explicit JSON argv so paths with spaces never go through a shell.
  // WHISPER_ARGV_JSON='["--model","small"]' is the supported knob.
  // Legacy WHISPER_ARGS is ignored when it would require shell splitting,
  // except for a single token without spaces (back-compat for "--model small"
  // style is intentionally NOT split).
  const json = process.env.WHISPER_ARGV_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (Array.isArray(parsed) && parsed.every((t) => typeof t === "string")) return parsed as string[];
    } catch {
      throw new Error("WHISPER_ARGV_JSON is not a JSON string array");
    }
  }
  return [];
}

/**
 * Vendor-neutral speech adapter. Runs a configured local executable with a
 * safe argv array (never a shell string). Returns an explicit unavailable
 * result when unconfigured instead of a false success.
 */
export async function transcribeAudio(input: { bytes: Buffer; mime: string; languageHints?: string[] }): Promise<
  | { ok: true; text: string; detectedLanguage?: string; uncertainSpans: string[] }
  | { ok: false; reason: string; fallback: string }
> {
  const mimeBase = input.mime.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(mimeBase)) {
    return { ok: false, reason: `Unsupported audio type ${input.mime}`, fallback: "Send text or a voice note under 2 minutes and I will type it out." };
  }
  if (input.bytes.length === 0) {
    return { ok: false, reason: "Empty audio payload", fallback: "Type the order as text and I will draft it." };
  }
  if (input.bytes.length > MAX_BYTES) {
    return { ok: false, reason: "Audio exceeds the 10 MB / 2 minute demo limit", fallback: "Send a shorter voice note or type the pickup details." };
  }
  const command = process.env.WHISPER_COMMAND;
  if (!command) {
    return { ok: false, reason: "Speech transcription is not configured on this server", fallback: "Type the order as text: service, garment count, pickup time, address." };
  }
  const dir = await mkdtemp(join(tmpdir(), "laundry-audio-"));
  const file = join(dir, `note${suffixForMime(mimeBase)}`);
  try {
    await writeFile(file, input.bytes);
    const argv = [...extraArgv()];
    // Pass cache dir explicitly so local runs do not depend on HOME.
    const cacheDir = process.env.WHISPER_CACHE_DIR;
    if (cacheDir && !argv.includes("--cache-dir")) argv.push("--cache-dir", cacheDir);
    if (input.languageHints?.[0] && !argv.includes("--language")) argv.push("--language", input.languageHints[0]);
    argv.push(file);
    const raw = await runExec(command, argv, TIMEOUT_MS);
    const parsed = parseTranscriberJson(raw);
    const text = (parsed.text ?? "").slice(0, 2000).trim();
    if (!text) {
      return { ok: false, reason: parsed.error ?? "Transcription returned no text", fallback: "Type the order as text and I will draft it." };
    }
    const uncertain = Array.isArray(parsed.uncertainSpans) ? parsed.uncertainSpans.filter((s): s is string => typeof s === "string").slice(0, 20) : [];
    return { ok: true, text, detectedLanguage: typeof parsed.language === "string" ? parsed.language : undefined, uncertainSpans: uncertain };
  } catch (e) {
    return { ok: false, reason: `Transcription failed: ${(e as Error).message}`, fallback: "Type the order as text and I will draft it." };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseTranscriberJson(raw: string): { text?: string; language?: unknown; uncertainSpans?: unknown; error?: string } {
  // cli.py emits JSON {text, language, uncertainSpans} on success and
  // {error, code, text:"", ...} on failure. Never treat plain stdout as transcript.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("transcriber returned non-JSON output");
  const slice = raw.slice(start, end + 1);
  return JSON.parse(slice) as { text?: string; language?: unknown; uncertainSpans?: unknown; error?: string };
}

function runExec(command: string, argv: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Safe argv array, never a shell string, so paths with spaces are fine.
    const child = spawn(command, argv, { stdio: ["ignore", "pipe", "pipe"] });
    let outBytes = 0;
    let errBytes = 0;
    let out = "";
    let err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("transcription timed out")); }, timeoutMs);
    child.stdout.on("data", (d) => {
      const s = String(d);
      // Bound subprocess output so a runaway transcriber cannot grow memory.
      if (outBytes + s.length > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        reject(new Error("transcriber output exceeded 256 KB"));
        return;
      }
      outBytes += s.length;
      out += s;
    });
    child.stderr.on("data", (d) => {
      const s = String(d);
      if (errBytes + s.length > MAX_OUTPUT_BYTES) return;
      errBytes += s.length;
      err += s;
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim() || err.trim());
      else reject(new Error(`transcriber exited ${code}: ${err.slice(0, 300)}`));
    });
  });
}
