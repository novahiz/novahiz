/**
 * `novahiz credentials` — operate the encrypted vault from the terminal.
 *
 * The value never appears in a listing or in a log: `list` shows metadata and
 * a masked preview, `get` requires `--reveal` to print plaintext, and the
 * vault path is the only thing that changes when a secret is set.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";

import { asString, emit, flagOn, splitList, type Parsed } from "./context.ts";
import {
  cleanVaultTemps,
  credentialsDoctor,
  credentialsKeyPath,
  ensureCredentialKey,
  exportEnv,
  listCredentials,
  removeCredential,
  resolveCredentialsMemoryDir,
  revealCredential,
  setCredential,
  syncCredentialIndex,
  syncCredentialIndexIfStale,
  vaultPath,
  type CredentialError
} from "../credentials.ts";

function projectRoot(parsed: Parsed): string {
  const raw = asString(parsed.flags.root) || asString(parsed.flags.project);
  return raw.length > 0 ? raw : process.cwd();
}

/** Read a value from stdin without echoing it to the terminal. */
async function readHidden(prompt: string): Promise<string> {
  const sink = new PassThrough();
  const rl = createInterface({ input: process.stdin, output: sink, terminal: true });
  process.stdout.write(prompt);
  try {
    return await new Promise<string>((resolve) => rl.question("", resolve));
  } finally {
    rl.close();
    process.stdout.write("\n");
  }
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8").replace(/\r?\n$/, "");
  } catch {
    return "";
  }
}

export async function commandCredentials(parsed: Parsed): Promise<void> {
  const sub = (parsed.positionals[1] ?? "list").toLowerCase();
  const root = projectRoot(parsed);
  const memoryDir = resolveCredentialsMemoryDir(root, root);

  try {
    switch (sub) {
      case "init": {
        const result = ensureCredentialKey({ force: flagOn(parsed, "force") });
        emit(parsed, result, () =>
          result.created
            ? `Clé maîtresse créée: ${result.path}\nGarde-la hors de git. Sans elle, aucun coffre n'est lisible.`
            : `Clé maîtresse déjà présente: ${result.path}`
        );
        return;
      }
      case "set": {
        const provider = parsed.positionals[2] ?? "";
        const field = parsed.positionals[3] ?? "";
        const fromFlag = asString(parsed.flags.value);
        let value = fromFlag;
        if (value.length === 0 && flagOn(parsed, "stdin")) value = readStdin();
        if (value.length === 0 && process.stdin.isTTY) {
          value = await readHidden(`Valeur pour ${provider}/${field} (entrée masquée): `);
        }
        if (value.length === 0) {
          process.stderr.write(
            "novahiz credentials: valeur absente. Fournis --value <v>, ou --stdin " +
              "(`echo $SECRET | novahiz credentials set <provider> <field> --stdin`).\n"
          );
          process.exitCode = 2;
          return;
        }
        const summary = setCredential({
          memoryDir,
          provider,
          field,
          value,
          env: asString(parsed.flags.env) || undefined,
          label: asString(parsed.flags.label) || undefined,
          fieldLabel: asString(parsed.flags["field-label"]) || undefined,
          account: asString(parsed.flags.account) || undefined,
          note: asString(parsed.flags.note) || undefined
        });
        emit(parsed, { memoryDir, vault: vaultPath(memoryDir), provider: summary }, () =>
          `Enregistré: ${summary.provider}/${field} (valeur chiffrée, ${value.length} caractères).\nIndex mémoire mis à jour.`
        );
        return;
      }
      case "list": {
        // Auto-heal: un coffre ecrit depuis un autre terminal ou une autre
        // session laisserait sinon un index qui decrit un etat perime.
        syncCredentialIndexIfStale(memoryDir);
        const summaries = listCredentials(memoryDir);
        emit(
          parsed,
          { memoryDir, vault: vaultPath(memoryDir), count: summaries.length, providers: summaries },
          () => {
            if (summaries.length === 0) return `Aucun identifiant enregistré dans ${vaultPath(memoryDir)}`;
            const lines = [`${summaries.length} provider(s) — valeurs chiffrées:`, ""];
            for (const summary of summaries) {
              lines.push(`  ${summary.provider}${summary.account ? ` (${summary.account})` : ""}`);
              for (const field of summary.fields) {
                lines.push(`    ${field.name}${field.env ? ` → ${field.env}` : ""}  ${field.masked}`);
              }
            }
            return lines.join("\n");
          }
        );
        return;
      }
      case "get": {
        const provider = parsed.positionals[2] ?? "";
        const field = asString(parsed.flags.field) || undefined;
        syncCredentialIndexIfStale(memoryDir);
        const summaries = listCredentials(memoryDir).filter((entry) => entry.provider === provider);
        if (summaries.length === 0) {
          process.stderr.write(`novahiz credentials: provider inconnu: ${provider}\n`);
          process.exitCode = 1;
          return;
        }
        if (!flagOn(parsed, "reveal")) {
          emit(parsed, { memoryDir, provider: summaries[0] }, () =>
            [
              `${provider} — métadonnées (aucune valeur affichée):`,
              ...summaries[0].fields.map(
                (entry) => `  ${entry.name}${entry.env ? ` → ${entry.env}` : ""}  ${entry.masked}`
              ),
              "",
              "Ajoute --reveal pour afficher la valeur en clair."
            ].join("\n")
          );
          return;
        }
        const revealed = revealCredential({ memoryDir, provider, field });
        emit(parsed, revealed, () =>
          revealed.fields.map((entry) => (field ? entry.value : `${entry.name}=${entry.value}`)).join("\n")
        );
        return;
      }
      case "remove": {
        const provider = parsed.positionals[2] ?? "";
        const field = asString(parsed.flags.field) || undefined;
        const result = removeCredential({ memoryDir, provider, field });
        emit(parsed, result, () =>
          result.deleted
            ? `Provider supprimé: ${result.provider} (${result.removed.join(", ") || "aucun champ"})`
            : `Champ(s) supprimé(s): ${result.provider}/${result.removed.join(", ")}`
        );
        return;
      }
      case "index": {
        const result = syncCredentialIndex(memoryDir);
        emit(parsed, { memoryDir, slot: result.slot.id, changed: result.changed }, () =>
          result.changed
            ? `Index mémoire réécrit: ${result.slot.id} (${result.slot.file})`
            : `Index mémoire déjà à jour: ${result.slot.id}`
        );
        return;
      }
      case "export": {
        const result = exportEnv({
          memoryDir,
          projectRoot: root,
          out: asString(parsed.flags.out) || undefined,
          providers: splitList(parsed.flags.providers),
          force: flagOn(parsed, "force")
        });
        if (!result.written) {
          process.stderr.write(
            `novahiz credentials: ${result.path} existe déjà. Relance avec --force pour l'écraser.\n`
          );
          process.exitCode = 1;
          return;
        }
        emit(parsed, result, () => `Écrit ${result.path} (${result.variables.length} variable(s)).`);
        return;
      }
      case "doctor": {
        // Meme regle qu'en lecture: doctor ne signale pas une derive qu'il
        // pourrait corriger. Un echec de synchro reste rapporte par les checks.
        let indexHealed = false;
        try {
          indexHealed = syncCredentialIndexIfStale(memoryDir).changed;
        } catch {
          // credentialsDoctor rapporte deja la cause (cle absente, coffre altere).
        }
        const report = credentialsDoctor(memoryDir, root);
        emit(parsed, { ...report, indexHealed }, () => {
          const lines = [`Coffre: ${report.vault}`, `Clé:    ${credentialsKeyPath()}`, ""];
          for (const check of report.checks) {
            lines.push(`  ${check.ok ? "OK  " : "FAIL"} ${check.id}: ${check.detail}`);
          }
          if (indexHealed) lines.push("", "Index mémoire resynchronisé automatiquement.");
          return lines.join("\n");
        });
        if (!report.ok) process.exitCode = 1;
        return;
      }
      case "destroy": {
        if (!flagOn(parsed, "force")) {
          process.stderr.write("novahiz credentials: destroy supprime le coffre. Relance avec --force.\n");
          process.exitCode = 1;
          return;
        }
        const { destroyVault } = await import("../credentials.ts");
        const removed = destroyVault(memoryDir);
        const temps = cleanVaultTemps(memoryDir);
        emit(parsed, { memoryDir, removed, temps }, () =>
          removed ? `Coffre supprimé: ${vaultPath(memoryDir)}` : "Aucun coffre à supprimer."
        );
        return;
      }
      default:
        process.stderr.write(
          `novahiz credentials: sous-commande inconnue "${sub}" ` +
            "(attendu: init, set, list, get, remove, index, export, doctor, destroy)\n"
        );
        process.exitCode = 1;
        return;
    }
  } catch (error) {
    if ((error as CredentialError)?.code) {
      process.stderr.write(`novahiz credentials: ${(error as Error).message} [${(error as CredentialError).code}]\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
