// Chemin de rafraichissement des skills (2026-10-15): `deps --install` saute
// tout pack deja present (`installedWhen` satisfait), donc la commande
// /novahiz-skills-update ne rafraichissait jamais flutter/dart/expo — l'observe
// etait que l'etape 3 rendait skipped: [flutter-skills, dart-skills, expo-skills].
// Ce fichier verrouille le nouveau chemin `update`: le catalogue porte la
// commande officielle, updateCommands l'execute quoi qu'il arrive a
// installedWhen, et la commande markdown appelle bien `--update`.
// Pur et hors reseau: aucun spawn, aucun fichier ecrit hors lecture.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSpec } from "../src/spec.ts";
import { pendingInstallCommands, updateCommands } from "../src/providers.ts";
import type { Spec } from "../src/spec.ts";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");

const COMMAND_MD = "adapters/opencode/commands/novahiz-skills-update.md";

function specWith(providers: Spec["providers"]): Spec {
  return { providers, config: { providers: { disabled: [] } } } as unknown as Spec;
}

test("le catalogue livré donne une commande update aux quatre packs de skills", () => {
  const spec = loadSpec(repoRoot);
  assert.ok(spec.providers.length > 0, "catalogue illisible: ce test n'a rien prouvé");

  const ids = ["flutter-skills", "dart-skills", "expo-skills", "impeccable"];
  for (const id of ids) {
    const provider = spec.providers.find((entry) => entry.id === id);
    assert.ok(provider, `provider absent du catalogue: ${id}`);
    assert.ok(
      Array.isArray(provider.install) && provider.install.length > 0,
      `${id}: sans install pas de pack du tout`
    );
    assert.ok(
      Array.isArray(provider.update) && provider.update.length > 0,
      `${id}: pas de commande update — /novahiz-skills-update ne peut pas le rafraichir`
    );
    const command = (provider.update ?? []).join(" ");
    assert.match(command, /\bskills\b/, `${id}: update ne passe pas par le CLI skills officiel`);
    assert.match(command, /\bupdate\b/, `${id}: update n'invoque pas la sous-commande update`);
    assert.match(command, /(^| )-g( |$)/, `${id}: update doit viser les skills globales (-g)`);
  }
});

test("update ignore installedWhen: c'est bien ce que deps --install ne faisait pas", () => {
  const providers: Spec["providers"] = [
    {
      id: "pack",
      label: "Pack",
      kind: "skill",
      install: ["npx", "-y", "skills", "add", "pack"],
      update: ["npx", "-y", "skills", "update", "-g", "-y"],
      installedWhen: ["marker"]
    }
  ];
  const spec = specWith(providers);
  const installed = new Set(["marker"]);

  // Le defect observe: install saute, donc aucun rafraichissement possible.
  assert.deepEqual(
    pendingInstallCommands(spec, installed).map((entry) => entry.id),
    [],
    "sanity: avec installedWhen satisfait, l'install saute bien (c'est ce qui bloquait)"
  );

  // update fait le travail que l'install refuse de faire.
  const update = updateCommands(spec);
  assert.deepEqual(update.map((entry) => entry.id), ["pack"], "update doit partir malgré installedWhen");
  assert.deepEqual(update[0]?.command, ["npx", "-y", "skills", "update", "-g", "-y"], "la commande update est prise telle quelle");
});

test("sans champ update, on retombe sur la commande d'install (re-add = resync upstream)", () => {
  const spec = specWith([
    { id: "legacy", label: "Legacy", kind: "skill", install: ["npx", "-y", "skills", "add", "legacy"] }
  ]);
  const update = updateCommands(spec);
  assert.deepEqual(update.map((entry) => entry.id), ["legacy"]);
  assert.deepEqual(update[0]?.command, ["npx", "-y", "skills", "add", "legacy"], "fallback: install faute de update");
});

test("un pack sans install n'apparait jamais dans le plan de update", () => {
  const spec = specWith([
    { id: "mcp-only", label: "MCP", kind: "mcp", update: ["npx", "-y", "skills", "update", "-g", "-y"] },
    { id: "with-install", label: "Pack", kind: "skill", install: ["npx", "-y", "skills", "add", "x"] }
  ]);
  assert.deepEqual(updateCommands(spec).map((entry) => entry.id), ["with-install"], "pas d'install = rien a rafraichir");
});

test("une commande update partagee est executee une fois et couvre chaque provider", () => {
  const shared = ["npx", "-y", "skills", "update", "-g", "-y"];
  const spec = specWith([
    { id: "flutter", label: "F", kind: "skill", install: ["npx", "add", "f"], update: shared },
    { id: "expo", label: "E", kind: "skill", install: ["npx", "add", "e"], update: shared },
    { id: "dart", label: "D", kind: "skill", install: ["npx", "add", "d"], update: shared }
  ]);
  const update = updateCommands(spec);
  assert.equal(update.length, 1, "le meme argv ne doit pas etre lance trois fois");
  assert.deepEqual(update[0]?.command, shared);
  // Le rapport ne doit pas attribuer la mise a jour globale au seul premier
  // provider: covers nomme tous ceux que la commande couvre reellement.
  assert.deepEqual(update[0]?.covers, ["flutter", "expo", "dart"], "covers doit nommer chaque provider couvert");
});

test("updateCommands ne produit jamais de doublon d'execution", () => {
  const spec = loadSpec(repoRoot);
  const commands = updateCommands(spec).map((entry) => entry.command.join(" "));
  assert.equal(new Set(commands).size, commands.length, "deux entries avec le meme argv: une execution doublee");
});

test("la commande /novahiz-skills-update appelle bien deps --install --update", () => {
  const markdown = readFileSync(resolve(repoRoot, COMMAND_MD), "utf8");
  assert.match(
    markdown,
    /deps --install --update --yes/,
    `${COMMAND_MD} n'invoque pas le drapeau --update: le rafraichissement ne se declencherait jamais`
  );
  // L'etape install seule doit rester presente (elle remplit les packs manquants),
  // mais elle ne peut plus etre presentee comme la mise a jour.
  assert.match(markdown, /deps --install --yes/, "l'etape d'install des packs manquants a disparu");
  assert.doesNotMatch(
    markdown,
    /flutter\/agent-plugins/,
    "le nom officiel du depot Flutter est flutter/skills (blog flutter.dev); agent-plugins n'est qu'un alias"
  );
});
