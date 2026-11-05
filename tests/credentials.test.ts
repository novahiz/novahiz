import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import {
  CREDENTIAL_TAG,
  credentialIndexBlock,
  credentialIndexStale,
  credentialsDoctor,
  ensureCredentialIndexSlot,
  exportEnv,
  listCredentials,
  maskSecret,
  readVault,
  removeCredential,
  resolveCredentialsMemoryDir,
  revealCredential,
  setCredential,
  syncCredentialIndex,
  syncCredentialIndexIfStale,
  vaultPath,
  KEY_ENV
} from "../src/credentials.ts";
import { archiveSlot } from "../src/memory.ts";

const made: string[] = [];
const SECRET = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SUPERSECRETVALUE.signature";

function workspace(): { root: string; memoryDir: string } {
  const root = mkdtempSync(join(tmpdir(), "novahiz-cred-"));
  made.push(root);
  return { root, memoryDir: resolveCredentialsMemoryDir(root, root) };
}

function useKey(seed: string): void {
  process.env[KEY_ENV] = Buffer.from(seed.padEnd(32, "x").slice(0, 32), "utf8").toString("base64");
}

beforeEach(() => {
  useKey("test-key-alpha");
});

after(() => {
  delete process.env[KEY_ENV];
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("credentials: la valeur reste dans le coffre, les metadonnees dans le slot", () => {
  test("aller-retour set -> list -> reveal -> remove", () => {
    const { memoryDir } = workspace();
    const saved = setCredential({
      memoryDir,
      provider: "supabase",
      field: "SUPABASE_ANON_KEY",
      value: SECRET,
      env: "SUPABASE_ANON_KEY",
      account: "client@example.com"
    });

    // list ne rend jamais la valeur
    const listed = listCredentials(memoryDir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].provider, "supabase");
    assert.equal(listed[0].account, "client@example.com");
    assert.equal(listed[0].fields[0].env, "SUPABASE_ANON_KEY");
    assert.ok(!JSON.stringify(listed).includes(SECRET), "list a fui la valeur");
    assert.ok(listed[0].fields[0].masked.startsWith("eyJh"));

    // reveal rend la valeur en clair, sur demande explicite
    const revealed = revealCredential({ memoryDir, provider: "supabase" });
    assert.equal(revealed.fields[0].value, SECRET);

    // remove supprime le provider et l'index suit
    const removed = removeCredential({ memoryDir, provider: "supabase" });
    assert.equal(removed.deleted, true);
    assert.deepEqual(listCredentials(memoryDir), []);
    assert.equal(saved.provider, "supabase");
  });

  test("le fichier de coffre ne contient pas la valeur en clair", () => {
    const { memoryDir } = workspace();
    setCredential({ memoryDir, provider: "resend", field: "RESEND_API_KEY", value: SECRET });
    const raw = readFileSync(vaultPath(memoryDir));
    assert.ok(!raw.includes(SECRET), "la valeur apparaît en clair dans le coffre");
    assert.ok(raw.includes("aes-256-gcm"));
  });

  test("le slot memoire ne contient aucune valeur et porte le tag credentials", () => {
    const { memoryDir } = workspace();
    setCredential({
      memoryDir,
      provider: "openrouter",
      field: "OPENROUTER_API_KEY",
      value: SECRET,
      env: "OPENROUTER_API_KEY"
    });
    const index = JSON.parse(readFileSync(join(memoryDir, "index.json"), "utf8")) as {
      slots: Array<{ id: string; file: string; tags: string[] }>;
    };
    const slot = index.slots.find((entry) => entry.tags.includes(CREDENTIAL_TAG));
    assert.ok(slot, "slot credentials absent");
    const slotText = readFileSync(join(memoryDir, slot!.file), "utf8");
    assert.ok(!slotText.includes(SECRET), "le slot a fui la valeur");
    assert.ok(slotText.includes("| openrouter |"));
    assert.ok(slotText.includes("OPENROUTER_API_KEY"));
  });

  test("l'index est idempotent: un second passage ne reecrit pas le slot", () => {
    const { memoryDir } = workspace();
    setCredential({ memoryDir, provider: "supabase", field: "ANON", value: SECRET });
    const first = syncCredentialIndex(memoryDir);
    const second = syncCredentialIndex(memoryDir);
    assert.equal(second.changed, false);
    assert.equal(second.slot.id, first.slot.id);
  });

  test("une cle maitresse differente refuse de dechiffrer sans rien ecraser", () => {
    const { memoryDir } = workspace();
    setCredential({ memoryDir, provider: "supabase", field: "ANON", value: SECRET });
    const before = readFileSync(vaultPath(memoryDir));

    useKey("test-key-bravo");
    assert.throws(() => listCredentials(memoryDir), /déchiffrement impossible/);
    assert.throws(() => readVault(memoryDir), /déchiffrement impossible/);

    const after = readFileSync(vaultPath(memoryDir));
    assert.deepEqual(after, before, "un refus de dechiffrement a modifie le coffre");
  });

  test("un provider ou un champ invalide est refuse avant toute ecriture", () => {
    const { memoryDir } = workspace();
    assert.throws(
      () => setCredential({ memoryDir, provider: "../etc", field: "X", value: SECRET }),
      /provider invalide/
    );
    assert.throws(
      () => setCredential({ memoryDir, provider: "supabase", field: "a b", value: SECRET }),
      /nom de champ invalide/
    );
    assert.throws(
      () => setCredential({ memoryDir, provider: "supabase", field: "X", value: "" }),
      /valeur vide/
    );
  });

  test("export ecrit un .env.local et refuse d'ecraser sans force", () => {
    const { root, memoryDir } = workspace();
    setCredential({ memoryDir, provider: "resend", field: "RESEND_API_KEY", value: SECRET, env: "RESEND_API_KEY" });

    const first = exportEnv({ memoryDir, projectRoot: root });
    assert.equal(first.written, true);
    assert.deepEqual(first.variables, ["RESEND_API_KEY"]);
    const env = readFileSync(join(root, ".env.local"), "utf8");
    assert.ok(env.startsWith("RESEND_API_KEY="));
    assert.ok(env.includes(SECRET));

    const second = exportEnv({ memoryDir, projectRoot: root });
    assert.equal(second.written, false, "un second export ecrase le fichier sans --force");

    const forced = exportEnv({ memoryDir, projectRoot: root, force: true });
    assert.equal(forced.written, true);
  });

  test("le bloc injecte au prompt ne contient aucune valeur", () => {
    const { memoryDir } = workspace();
    setCredential({ memoryDir, provider: "supabase", field: "ANON", value: SECRET, env: "SUPABASE_ANON_KEY" });
    const block = credentialIndexBlock(memoryDir);
    assert.ok(block.length > 0);
    assert.ok(!block.join("\n").includes(SECRET));
    assert.ok(block.some((line) => line.includes("supabase")));
  });

  test("doctor signale un project-memory non gitignore", () => {
    const { root, memoryDir } = workspace();
    setCredential({ memoryDir, provider: "supabase", field: "ANON", value: SECRET });

    const withoutIgnore = credentialsDoctor(memoryDir, root);
    assert.equal(withoutIgnore.checks.find((check) => check.id === "gitignore")?.ok, false);

    writeFileSync(join(root, ".gitignore"), "node_modules/\nproject-memory/\n", "utf8");
    const withIgnore = credentialsDoctor(memoryDir, root);
    assert.equal(withIgnore.checks.find((check) => check.id === "gitignore")?.ok, true);
    assert.equal(withIgnore.checks.find((check) => check.id === "vault-decrypt")?.ok, true);
    assert.equal(withIgnore.checks.find((check) => check.id === "index-slot")?.ok, true);
  });

  test("maskSecret ne rend jamais la valeur entiere", () => {
    assert.equal(maskSecret(""), "");
    assert.equal(maskSecret("abcd"), "****");
    assert.ok(!maskSecret(SECRET).includes(SECRET));
    assert.ok(!maskSecret("short-secret").includes("short-secret"));
  });

  test("le slot d'index existe des l'initialisation, meme sans coffre", () => {
    const { memoryDir } = workspace();
    const slot = ensureCredentialIndexSlot(memoryDir);
    assert.ok(slot.tags.includes(CREDENTIAL_TAG));
    assert.equal(credentialIndexStale(memoryDir), false, "sans coffre, rien n'est obsolete");
    const text = readFileSync(join(memoryDir, slot.file), "utf8");
    assert.ok(text.includes("Aucune valeur"), "le slot doit annoncer qu'il ne porte pas de valeur");

    const again = ensureCredentialIndexSlot(memoryDir);
    assert.equal(again.id, slot.id, "ensureCredentialIndexSlot doit etre idempotent");
  });

  test("un coffre ecrit sans index est detecte et resynchronise automatiquement", () => {
    const { memoryDir } = workspace();
    setCredential({ memoryDir, provider: "resend", field: "RESEND_API_KEY", value: SECRET, env: "RESEND_API_KEY" });
    assert.equal(credentialIndexStale(memoryDir), false);

    // Ecriture directe du coffre, sans passer par l'index: c'est ce que fait un
    // `credentials set` lance depuis un autre terminal ou une version anterieure.
    setCredential({
      memoryDir,
      provider: "openrouter",
      field: "OPENROUTER_API_KEY",
      value: "sk-or-v1-second-secret-value",
      noIndex: true
    });
    assert.equal(credentialIndexStale(memoryDir), true, "un coffre plus recent doit rendre l'index obsolete");

    const healed = syncCredentialIndexIfStale(memoryDir);
    assert.equal(healed.changed, true);
    assert.equal(credentialIndexStale(memoryDir), false, "l'auto-reparation doit converger");

    const text = readFileSync(join(memoryDir, healed.slot!.file), "utf8");
    assert.ok(text.includes("| openrouter |"));
    assert.ok(!text.includes("sk-or-v1-second-secret-value"));
  });

  test("un slot archive rend l'index obsolete et la synchro le reconstruit seule", () => {
    const { memoryDir } = workspace();
    setCredential({ memoryDir, provider: "supabase", field: "ANON", value: SECRET, env: "SUPABASE_ANON_KEY" });
    assert.equal(credentialIndexStale(memoryDir), false);

    const index = JSON.parse(readFileSync(join(memoryDir, "index.json"), "utf8")) as {
      slots: Array<{ id: string; tags: string[] }>;
    };
    const slot = index.slots.find((entry) => entry.tags.includes(CREDENTIAL_TAG));
    assert.ok(slot);
    archiveSlot(slot!.id, memoryDir);
    assert.equal(credentialIndexStale(memoryDir), true, "un slot archive doit etre vu comme obsolete");

    const healed = syncCredentialIndexIfStale(memoryDir);
    assert.equal(healed.changed, true);
    assert.notEqual(healed.slot?.id, slot!.id, "un nouveau slot actif doit etre cree");
    assert.equal(credentialIndexStale(memoryDir), false);

    // la lecture qui suit voit toujours le provider
    assert.equal(listCredentials(memoryDir)[0].provider, "supabase");
  });
});

describe("credentials: surface MCP declaree et servie", () => {
  const source = readFileSync(join(process.cwd(), "mcp", "novahiz-tools", "index.mjs"), "utf8");

  for (const name of ["credentials_list", "credentials_lookup", "credentials_reveal", "credentials_save"]) {
    test(`${name} est declare et branche`, () => {
      assert.ok(source.includes(`name: "${name}"`), `${name} absent du schema MCP`);
      assert.ok(source.includes(`if (name === "${name}")`), `${name} declare mais non servi`);
    });
  }

  test("reveal exige confirm:true", () => {
    assert.ok(/confirm must be true/.test(source));
  });

  test("lookup ne renvoie pas de valeur", () => {
    const lookup = source.slice(source.indexOf('if (name === "credentials_lookup")'));
    const body = lookup.slice(0, lookup.indexOf('if (name === "credentials_reveal")'));
    assert.ok(!body.includes("revealCredential("), "lookup ne doit jamais dechiffrer");
    assert.ok(body.includes("valuesIncluded: false"));
  });
});
