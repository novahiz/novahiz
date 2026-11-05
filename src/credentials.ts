/**
 * Encrypted credential vault + searchable metadata index.
 *
 * Why two layers. The project memory is auto-injected into the agent prompt
 * (adapters/opencode/novahiz-plugin.ts, buildAutoRead) and indexed in SQLite:
 * a secret written into a slot would be copied into the model context, into
 * logs/, and into novahiz.sqlite on every session. So the value never lives in
 * a slot. A slot carries the metadata only — provider, env var names, account,
 * last update — which is what keeps the agent from asking again for something
 * it already owns, and the value lives in a local AES-256-GCM vault read only
 * on explicit request.
 *
 * Threat model, stated honestly: this protects against accidental disclosure
 * (git history, a slot injected in a prompt, a grep over the project, a shared
 * backup of the workspace). It does not protect against an attacker already
 * running code as the user on this machine — the key file is next to the vault
 * by design, because a keychain prompt on every tool call would make the
 * feature unusable.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  acquireRootLock,
  createSlot,
  ensureMemoryRoot,
  readIndex,
  resolveMemoryDir,
  updateSlot,
  type MemoryIndex,
  type SlotMeta
} from "./memory.ts";

export const VAULT_FILE = ".credentials.vault.json";
export const VAULT_LOCK = ".credentials.lock";
export const CREDENTIAL_TAG = "credentials";
export const CREDENTIAL_SLOT_TITLE = "Credentials (metadata only)";
export const KEY_ENV = "NOVAHIZ_CREDENTIAL_KEY";
export const KEY_BYTES = 32;

const AAD = Buffer.from("novahiz-credentials:v1", "utf8");
const VAULT_VERSION = 1;
const SCRYPT_SALT_BYTES = 16;
const IV_BYTES = 12;
const MAX_INDEX_ROWS = 60;
const PROVIDER_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const FIELD_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export type CredentialError = Error & { code: string };

function credError(code: string, message: string): CredentialError {
  const error = new Error(message) as CredentialError;
  error.code = code;
  return error;
}

function nowIso(): string {
  return new Date().toISOString();
}

function b64(buffer: Buffer): string {
  return buffer.toString("base64");
}

function unb64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

// ---------------------------------------------------------------------------
// Master key
// ---------------------------------------------------------------------------

/** Directory holding the master key. Outside the project, never in git. */
export function credentialKeyDir(): string {
  return join(homedir(), ".novahiz");
}

export function credentialsKeyPath(): string {
  return join(credentialKeyDir(), "credential-key");
}

type KeyFile = { version: 1; key: string; created: string };

/**
 * Read the master key. The environment variable wins so CI and ephemeral
 * containers can inject a key without touching the filesystem.
 */
export function readCredentialKey(): Buffer | null {
  const fromEnv = process.env[KEY_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    const key = unb64(fromEnv.trim());
    if (key.length !== KEY_BYTES) {
      throw credError("E_CRED_KEY", `${KEY_ENV} doit contenir ${KEY_BYTES} octets encodés en base64`);
    }
    return key;
  }
  const path = credentialsKeyPath();
  if (!existsSync(path)) return null;
  let parsed: KeyFile;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as KeyFile;
  } catch {
    throw credError("E_CRED_KEY", `clé maîtresse illisible: ${path}`);
  }
  const key = unb64(String(parsed.key ?? ""));
  if (key.length !== KEY_BYTES) {
    throw credError("E_CRED_KEY", `clé maîtresse invalide (${key.length} octets au lieu de ${KEY_BYTES}): ${path}`);
  }
  return key;
}

export type EnsureKeyResult = { path: string; created: boolean };

/**
 * Create the master key on first use. `force` rotates it, which makes every
 * existing vault undecryptable — the caller must confirm explicitly.
 */
export function ensureCredentialKey(options: { force?: boolean } = {}): EnsureKeyResult {
  const path = credentialsKeyPath();
  if (existsSync(path) && !options.force) return { path, created: false };
  mkdirSync(credentialKeyDir(), { recursive: true, mode: 0o700 });
  const body: KeyFile = { version: 1, key: b64(randomBytes(KEY_BYTES)), created: nowIso() };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ignore le mode POSIX; le profil utilisateur reste la frontiere.
  }
  return { path, created: true };
}

// ---------------------------------------------------------------------------
// Vault format and encryption
// ---------------------------------------------------------------------------

export type StoredField = {
  value: string;
  /** Environment variable the application should read. */
  env?: string;
  label?: string;
  updated: string;
};

export type StoredRecord = {
  provider: string;
  label?: string;
  account?: string;
  note?: string;
  created: string;
  updated: string;
  fields: Record<string, StoredField>;
};

type VaultPayload = { version: 1; records: Record<string, StoredRecord> };

type VaultFile = {
  version: 1;
  alg: "aes-256-gcm";
  kdf: "scrypt";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  updated: string;
};

/** Resolve the memory directory, tolerating a project root or the dir itself. */
export function resolveCredentialsMemoryDir(raw?: string, workspace?: string): string {
  return resolveMemoryDir(raw, workspace).dir;
}

export function vaultPath(memoryDir: string): string {
  return join(memoryDir, VAULT_FILE);
}

function deriveKey(master: Buffer, salt: Buffer): Buffer {
  return scryptSync(master, salt, KEY_BYTES, { N: 16384, r: 8, p: 1 });
}

function encryptPayload(payload: VaultPayload, master: Buffer): VaultFile {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(master, salt), iv);
  cipher.setAAD(AAD);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: VAULT_VERSION,
    alg: "aes-256-gcm",
    kdf: "scrypt",
    salt: b64(salt),
    iv: b64(iv),
    tag: b64(cipher.getAuthTag()),
    ciphertext: b64(ciphertext),
    updated: nowIso()
  };
}

function decryptVault(file: VaultFile, master: Buffer): VaultPayload {
  let key: Buffer;
  let iv: Buffer;
  let tag: Buffer;
  let ciphertext: Buffer;
  try {
    key = deriveKey(master, unb64(file.salt));
    iv = unb64(file.iv);
    tag = unb64(file.tag);
    ciphertext = unb64(file.ciphertext);
  } catch {
    throw credError("E_CRED_VAULT", "coffre corrompu: en-tête illisible");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as VaultPayload;
    if (!parsed || typeof parsed !== "object" || !parsed.records) {
      throw new Error("payload vide");
    }
    return parsed;
  } catch {
    // AES-GCM authentifie: un echec ici signifie cle differente ou coffre
    // altere. Jamais de repli silencieux vers un coffre vide — cela ecraserait
    // des secrets existants a la prochaine ecriture.
    throw credError(
      "E_CRED_KEY",
      "déchiffrement impossible: clé maîtresse différente ou coffre altéré. Aucune valeur n'a été modifiée."
    );
  }
}

/** Read and decrypt the vault. Absent vault = empty payload, never an error. */
export function readVault(memoryDir: string): VaultPayload {
  const path = vaultPath(memoryDir);
  if (!existsSync(path)) return { version: VAULT_VERSION, records: {} };
  let file: VaultFile;
  try {
    file = JSON.parse(readFileSync(path, "utf8")) as VaultFile;
  } catch {
    throw credError("E_CRED_VAULT", `coffre illisible: ${path}`);
  }
  if (!file || file.version !== VAULT_VERSION || file.alg !== "aes-256-gcm") {
    throw credError("E_CRED_VAULT", `format de coffre non supporté dans ${path}`);
  }
  const master = readCredentialKey();
  if (!master) {
    throw credError(
      "E_CRED_KEY",
      `clé maîtresse absente (${credentialsKeyPath()}). Lance \`novahiz credentials init\`.`
    );
  }
  return decryptVault(file, master);
}

function writeVaultUnlocked(memoryDir: string, payload: VaultPayload): void {
  const master = readCredentialKey();
  if (!master) {
    throw credError(
      "E_CRED_KEY",
      `clé maîtresse absente (${credentialsKeyPath()}). Lance \`novahiz credentials init\`.`
    );
  }
  mkdirSync(memoryDir, { recursive: true });
  const target = vaultPath(memoryDir);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(encryptPayload(payload, master), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  renameSync(temporary, target);
  try {
    chmodSync(target, 0o600);
  } catch {
    // Voir ensureCredentialKey: Windows n'applique pas le mode POSIX.
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function assertProvider(provider: string): string {
  const value = provider.trim();
  if (!PROVIDER_RE.test(value)) {
    throw credError(
      "E_CRED_PROVIDER",
      `provider invalide: ${JSON.stringify(provider)} (lettres, chiffres, point, tiret, underscore)`
    );
  }
  return value.toLowerCase();
}

export function assertFieldName(name: string): string {
  const value = name.trim();
  if (!FIELD_RE.test(value)) {
    throw credError("E_CRED_FIELD", `nom de champ invalide: ${JSON.stringify(name)}`);
  }
  return value;
}

/** Masked preview, safe to display and to log. */
export function maskSecret(value: string): string {
  if (value.length === 0) return "";
  if (value.length <= 4) return "****";
  if (value.length <= 12) return `${value.slice(0, 2)}…${value.slice(-1)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Public summaries (never carry a value)
// ---------------------------------------------------------------------------

export type CredentialFieldSummary = {
  name: string;
  env?: string;
  label?: string;
  updated: string;
  masked: string;
};

export type CredentialSummary = {
  provider: string;
  label?: string;
  account?: string;
  note?: string;
  created: string;
  updated: string;
  fields: CredentialFieldSummary[];
};

function summarize(record: StoredRecord): CredentialSummary {
  return {
    provider: record.provider,
    ...(record.label ? { label: record.label } : {}),
    ...(record.account ? { account: record.account } : {}),
    ...(record.note ? { note: record.note } : {}),
    created: record.created,
    updated: record.updated,
    fields: Object.entries(record.fields)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, field]) => ({
        name,
        ...(field.env ? { env: field.env } : {}),
        ...(field.label ? { label: field.label } : {}),
        updated: field.updated,
        masked: maskSecret(field.value)
      }))
  };
}

export function listCredentials(memoryDir: string): CredentialSummary[] {
  const payload = readVault(memoryDir);
  return Object.values(payload.records)
    .sort((a, b) => a.provider.localeCompare(b.provider))
    .map(summarize);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type SetCredentialInput = {
  memoryDir: string;
  provider: string;
  field: string;
  value: string;
  env?: string;
  label?: string;
  fieldLabel?: string;
  account?: string;
  note?: string;
  /** Skip the metadata index rebuild (used by bulk imports). */
  noIndex?: boolean;
};

export function setCredential(input: SetCredentialInput): CredentialSummary {
  const provider = assertProvider(input.provider);
  const field = assertFieldName(input.field);
  if (input.value.length === 0) {
    throw credError("E_CRED_VALUE", "valeur vide: rien à stocker");
  }
  const stamp = nowIso();
  if (!existsSync(credentialsKeyPath()) && !process.env[KEY_ENV]) {
    ensureCredentialKey();
  }
  const release = acquireRootLock(input.memoryDir);
  let summary: CredentialSummary;
  try {
    const payload = readVault(input.memoryDir);
    const existing = payload.records[provider];
    const record: StoredRecord = existing ?? {
      provider,
      created: stamp,
      updated: stamp,
      fields: {}
    };
    if (input.label !== undefined) record.label = input.label.trim() || undefined;
    if (input.account !== undefined) record.account = input.account.trim() || undefined;
    if (input.note !== undefined) record.note = input.note.trim() || undefined;
    record.updated = stamp;
    const previous = record.fields[field];
    const env = input.env?.trim() || previous?.env;
    const fieldLabel = input.fieldLabel?.trim() || previous?.label;
    record.fields[field] = {
      value: input.value,
      updated: stamp,
      ...(env ? { env } : {}),
      ...(fieldLabel ? { label: fieldLabel } : {})
    };
    payload.records[provider] = record;
    writeVaultUnlocked(input.memoryDir, payload);
    summary = summarize(record);
  } finally {
    release();
  }
  if (!input.noIndex) syncCredentialIndex(input.memoryDir);
  return summary;
}

export type RemoveCredentialResult = { provider: string; removed: string[]; deleted: boolean };

export function removeCredential(input: {
  memoryDir: string;
  provider: string;
  field?: string;
  noIndex?: boolean;
}): RemoveCredentialResult {
  const provider = assertProvider(input.provider);
  const release = acquireRootLock(input.memoryDir);
  let result: RemoveCredentialResult;
  try {
    const payload = readVault(input.memoryDir);
    const record = payload.records[provider];
    if (!record) throw credError("E_CRED_PROVIDER", `provider inconnu: ${provider}`);
    let removed: string[];
    let deleted: boolean;
    if (input.field) {
      const field = assertFieldName(input.field);
      if (!record.fields[field]) throw credError("E_CRED_FIELD", `champ inconnu: ${provider}/${field}`);
      delete record.fields[field];
      removed = [field];
      deleted = Object.keys(record.fields).length === 0;
    } else {
      removed = Object.keys(record.fields);
      deleted = true;
    }
    if (deleted) delete payload.records[provider];
    else record.updated = nowIso();
    writeVaultUnlocked(input.memoryDir, payload);
    result = { provider, removed, deleted };
  } finally {
    release();
  }
  if (!input.noIndex) syncCredentialIndex(input.memoryDir);
  return result;
}

export type RevealResult = {
  provider: string;
  fields: Array<{ name: string; env?: string; value: string }>;
};

/** Return plaintext values. Only call this on an explicit user/agent request. */
export function revealCredential(input: {
  memoryDir: string;
  provider: string;
  field?: string;
}): RevealResult {
  const provider = assertProvider(input.provider);
  const payload = readVault(input.memoryDir);
  const record = payload.records[provider];
  if (!record) throw credError("E_CRED_PROVIDER", `provider inconnu: ${provider}`);
  const names = input.field ? [assertFieldName(input.field)] : Object.keys(record.fields).sort();
  const fields = names.map((name) => {
    const stored = record.fields[name];
    if (!stored) throw credError("E_CRED_FIELD", `champ inconnu: ${provider}/${name}`);
    return { name, ...(stored.env ? { env: stored.env } : {}), value: stored.value };
  });
  return { provider, fields };
}

// ---------------------------------------------------------------------------
// Metadata index in project memory
// ---------------------------------------------------------------------------

/**
 * Render the metadata table. It reads only keys that cannot carry a secret:
 * provider, field name, env name, label, timestamps, masked preview.
 *
 * `vaultStamp` is the vault's own write timestamp, carried in clear in the
 * vault header. Writing it here gives the index a content-addressed revision:
 * a vault written from anywhere changes the stamp, so the slot necessarily
 * differs and gets rewritten. Without it, an idempotence check that compares
 * only the table could match, skip the write, and leave the index stale
 * forever — the exact trap that made the first version wrong.
 */
export function renderIndexDetails(records: StoredRecord[], vaultStamp: string | null = null): string {
  const lines: string[] = [
    `Coffre: ${vaultStamp ?? "aucun"}`,
    "Aucune valeur n'est stockée ici. Les valeurs vivent dans le coffre chiffré",
    "`project-memory/.credentials.vault.json` (AES-256-GCM, clé `~/.novahiz/credential-key`).",
    "",
    "| Provider | Champ | Variable d'env | Compte | Mis à jour |",
    "|---|---|---|---|---|"
  ];
  let rows = 0;
  for (const record of records.slice().sort((a, b) => a.provider.localeCompare(b.provider))) {
    for (const [name, field] of Object.entries(record.fields).sort(([a], [b]) => a.localeCompare(b))) {
      if (rows >= MAX_INDEX_ROWS) {
        lines.push(`| … | ${Object.keys(record.fields).length} champ(s) de plus | | | |`);
        return lines.join("\n");
      }
      lines.push(
        `| ${record.provider} | ${name} | ${field.env ?? "—"} | ${record.account ?? "—"} | ${field.updated.slice(0, 10)} |`
      );
      rows += 1;
    }
  }
  if (rows === 0) lines.push("| — | — | — | — | — |");
  return lines.join("\n");
}

/** Defense in depth: a rendered index must never contain a stored value. */
function assertNoValueLeak(rendered: string, payload: VaultPayload): void {
  for (const record of Object.values(payload.records)) {
    for (const [name, field] of Object.entries(record.fields)) {
      if (field.value.length >= 6 && rendered.includes(field.value)) {
        throw credError(
          "E_CRED_LEAK",
          `refus d'écrire l'index: la valeur du champ ${record.provider}/${name} apparaîtrait dans le slot mémoire`
        );
      }
    }
  }
}

export function findCredentialSlot(index: MemoryIndex): SlotMeta | null {
  return (
    index.slots.find(
      (slot) => slot.status !== "archived" && (slot.tags.includes(CREDENTIAL_TAG) || slot.title === CREDENTIAL_SLOT_TITLE)
    ) ?? null
  );
}

/**
 * Create or refresh the metadata slot, under an already-held root lock.
 * Split out so `syncCredentialIndex` and `ensureCredentialIndexSlot` share one
 * write path: two implementations would drift on the description text.
 */
function writeCredentialSlotUnlocked(
  memoryDir: string,
  details: string,
  providers: number
): { slot: SlotMeta; changed: boolean } {
  const index = ensureMemoryRoot(memoryDir);
  const existing = findCredentialSlot(index);
  if (!existing) {
    const { meta } = createSlot(memoryDir, {
      title: CREDENTIAL_SLOT_TITLE,
      description: `${providers} provider(s) — métadonnées seulement, valeurs dans le coffre chiffré`,
      tags: [CREDENTIAL_TAG, "secrets"]
    });
    const updated = updateSlot({ id: meta.id, root: memoryDir, mode: "replace", content: details });
    return { slot: updated.slot, changed: true };
  }
  const current = readFileSafe(join(memoryDir, existing.file));
  if (current.includes(details.trim())) return { slot: existing, changed: false };
  const updated = updateSlot({ id: existing.id, root: memoryDir, mode: "replace", content: details });
  return { slot: updated.slot, changed: true };
}

/** Vault write timestamp from the plaintext header. No decryption, no key. */
export function readVaultStamp(memoryDir: string): string | null {
  try {
    const file = JSON.parse(readFileSync(vaultPath(memoryDir), "utf8")) as { updated?: unknown };
    return typeof file.updated === "string" && file.updated.length > 0 ? file.updated : null;
  } catch {
    return null;
  }
}

/**
 * Rebuild the metadata slot from the vault. Idempotent: no change is written
 * when the slot already matches, so a routine call costs no file write.
 */
export function syncCredentialIndex(memoryDir: string): { slot: SlotMeta; changed: boolean } {
  const payload = readVault(memoryDir);
  const records = Object.values(payload.records);
  const details = renderIndexDetails(records, readVaultStamp(memoryDir));
  assertNoValueLeak(details, payload);
  const release = acquireRootLock(memoryDir);
  try {
    return writeCredentialSlotUnlocked(memoryDir, details, records.length);
  } finally {
    release();
  }
}

/** mtime of the vault file, or null when no vault exists yet. */
export function credentialVaultMtime(memoryDir: string): number | null {
  try {
    return statSync(vaultPath(memoryDir)).mtimeMs;
  } catch {
    return null;
  }
}


/**
 * True when the index no longer reflects the vault. Content-addressed on
 * purpose: the slot body carries the vault's write stamp, so "fresh" means the
 * body literally contains the current stamp. A timestamp comparison would miss
 * two real cases — a slot written by an older build (no marker at all) and a
 * slot whose file was replaced outside the index. Read-only, no decryption.
 */
export function credentialIndexStale(memoryDir: string): boolean {
  const stamp = readVaultStamp(memoryDir);
  if (stamp === null) return false;
  let index: MemoryIndex;
  try {
    index = readIndex(memoryDir);
  } catch {
    return true;
  }
  const slot = findCredentialSlot(index);
  if (!slot) return true;
  return !readFileSafe(join(memoryDir, slot.file)).includes(`Coffre: ${stamp}`);
}

/**
 * The automatic entry point: callers that read credentials run this first, so
 * a vault written from another terminal, another session or an older build
 * never leaves the injected block describing a stale state. No user action.
 */
export function syncCredentialIndexIfStale(memoryDir: string): { slot: SlotMeta | null; changed: boolean } {
  if (!credentialIndexStale(memoryDir)) {
    try {
      return { slot: findCredentialSlot(readIndex(memoryDir)), changed: false };
    } catch {
      return { slot: null, changed: false };
    }
  }
  return syncCredentialIndex(memoryDir);
}

/**
 * Create the slot even when no vault exists, so a freshly initialized project
 * already advertises the registry. Used by `novahiz init`; without it the block
 * appears only after the first credential is saved, which is exactly the state
 * that made the feature look absent after a restart.
 */
export function ensureCredentialIndexSlot(memoryDir: string): SlotMeta {
  const release = acquireRootLock(memoryDir);
  try {
    const providers = Object.keys(readVault(memoryDir).records).length;
    return writeCredentialSlotUnlocked(memoryDir, renderIndexDetails([]), providers).slot;
  } finally {
    release();
  }
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Session block (plugin injection) and environment export
// ---------------------------------------------------------------------------

/**
 * Compact block injected into the prompt. Metadata only, hard-capped: it tells
 * the agent what exists and how to reach it, never what the value is.
 */
export function credentialIndexBlock(memoryDir: string, maxChars = 700): string[] {
  let summaries: CredentialSummary[];
  try {
    summaries = listCredentials(memoryDir);
  } catch {
    return [];
  }
  if (summaries.length === 0) return [];
  const lines = [
    `[Novahiz credentials] ${summaries.length} provider(s) disponible(s) — valeurs chiffrées, jamais injectées:`
  ];
  let used = lines[0].length;
  for (const summary of summaries) {
    const names = summary.fields.map((field) => field.env ?? field.name).join(", ") || "(vide)";
    const line = `- ${summary.provider}: ${names}${summary.account ? ` · compte ${summary.account}` : ""}`;
    if (used + line.length + 1 > maxChars) {
      lines.push("- …");
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  lines.push(
    "Avant de demander un identifiant à l'utilisateur, appelle credentials_lookup (métadonnées) puis credentials_reveal si la valeur est réellement nécessaire."
  );
  return lines;
}

export type ExportEnvResult = { path: string; variables: string[]; written: boolean };

/** Write a .env file from the vault. Never overwrites without force. */
export function exportEnv(input: {
  memoryDir: string;
  projectRoot: string;
  out?: string;
  providers?: string[];
  force?: boolean;
}): ExportEnvResult {
  const payload = readVault(input.memoryDir);
  const wanted = input.providers?.map((provider) => provider.toLowerCase());
  const variables: string[] = [];
  const lines: string[] = [];
  for (const record of Object.values(payload.records).sort((a, b) => a.provider.localeCompare(b.provider))) {
    if (wanted && wanted.length > 0 && !wanted.includes(record.provider)) continue;
    for (const [name, field] of Object.entries(record.fields).sort(([a], [b]) => a.localeCompare(b))) {
      const env = field.env ?? `${record.provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${name.toUpperCase()}`;
      if (variables.includes(env)) continue;
      variables.push(env);
      lines.push(`${env}=${quoteEnv(field.value)}`);
    }
  }
  const target = resolve(input.out && input.out.length > 0 ? input.out : join(input.projectRoot, ".env.local"));
  if (existsSync(target) && !input.force) {
    return { path: target, variables, written: false };
  }
  writeFileSync(target, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  return { path: target, variables, written: true };
}

function quoteEnv(value: string): string {
  return /[\s"'#$`\\]/.test(value) ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;
}

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

export type DoctorCheck = { id: string; ok: boolean; detail: string };
export type DoctorReport = { ok: boolean; memoryDir: string; vault: string; checks: DoctorCheck[] };

/**
 * Report the state of the vault without ever decrypting into the output.
 * `projectRoot` is optional: without it the gitignore check is skipped and
 * reported as such rather than assumed green.
 */
export function credentialsDoctor(memoryDir: string, projectRoot?: string): DoctorReport {
  const checks: DoctorCheck[] = [];
  const keyPath = credentialsKeyPath();
  const keyFromEnv = typeof process.env[KEY_ENV] === "string" && process.env[KEY_ENV]!.length > 0;
  checks.push({
    id: "master-key",
    ok: keyFromEnv || existsSync(keyPath),
    detail: keyFromEnv ? `clé fournie par ${KEY_ENV}` : existsSync(keyPath) ? keyPath : `absent: ${keyPath}`
  });

  const path = vaultPath(memoryDir);
  const hasVault = existsSync(path);
  let providers: string[] = [];
  let fields = 0;
  if (hasVault) {
    try {
      const payload = readVault(memoryDir);
      providers = Object.keys(payload.records).sort();
      fields = providers.reduce((sum, provider) => sum + Object.keys(payload.records[provider].fields).length, 0);
      checks.push({ id: "vault-decrypt", ok: true, detail: `${providers.length} provider(s), ${fields} champ(s)` });
    } catch (error) {
      checks.push({ id: "vault-decrypt", ok: false, detail: (error as Error).message });
    }
  } else {
    checks.push({ id: "vault", ok: true, detail: "aucun coffre (rien à protéger pour l'instant)" });
  }

  let slotInSync = true;
  let slotDetail = "coffre absent";
  if (hasVault && providers.length > 0) {
    try {
      const index = ensureMemoryRoot(memoryDir);
      const slot = findCredentialSlot(index);
      if (!slot) {
        slotInSync = false;
        slotDetail = "slot d'index absent — lance `novahiz credentials index`";
      } else {
        const raw = readFileSafe(join(memoryDir, slot.file));
        const missing = providers.filter((provider) => !raw.includes(`| ${provider} |`));
        slotInSync = missing.length === 0;
        slotDetail = slotInSync ? `${slot.id} à jour` : `providers absents du slot: ${missing.join(", ")}`;
      }
    } catch (error) {
      slotInSync = false;
      slotDetail = (error as Error).message;
    }
  }
  checks.push({ id: "index-slot", ok: slotInSync, detail: slotDetail });

  if (projectRoot) {
    const gitignore = join(projectRoot, ".gitignore");
    if (!existsSync(gitignore)) {
      checks.push({ id: "gitignore", ok: false, detail: `pas de ${gitignore}: vérifie à la main` });
    } else {
      const text = readFileSync(gitignore, "utf8");
      const covered = /(^|\n)\/?project-memory\/?\s*($|\n)/.test(text) || text.includes(VAULT_FILE);
      checks.push({
        id: "gitignore",
        ok: covered,
        detail: covered ? "project-memory/ ignoré" : `project-memory/ non ignoré dans ${gitignore}`
      });
    }
  } else {
    checks.push({ id: "gitignore", ok: true, detail: "non vérifié (pas de projet fourni)" });
  }

  return { ok: checks.every((check) => check.ok), memoryDir, vault: path, checks };
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

/** Remove temporary files left by an interrupted vault write. */
export function cleanVaultTemps(memoryDir: string): number {
  const dir = dirname(vaultPath(memoryDir));
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(`${VAULT_FILE}.`) && name.endsWith(".tmp")) {
      try {
        unlinkSync(join(dir, name));
        removed += 1;
      } catch {
        // Un fichier déjà repris par un autre processus reste en place.
      }
    }
  }
  return removed;
}

/** Delete a vault file. Only used by `credentials destroy`. */
export function destroyVault(memoryDir: string): boolean {
  const path = vaultPath(memoryDir);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
