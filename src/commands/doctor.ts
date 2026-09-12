import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { dbPathFor, emit, type Parsed } from "./context.ts";
import { loadSpec, novahizHome } from "../spec.ts";
import { openDb } from "../db.ts";
import { loadInstalledSkills } from "../catalog.ts";
import { evaluateGate } from "../gate.ts";
import * as ui from "../render.ts";

export type DoctorCheck = { id: string; label: string; ok: boolean; detail: string; blocking: boolean };

export const SKILL_CLI: Record<string, string> = { defuddle: "defuddle" };

export function hasCommand(name: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [name], { encoding: "utf8", shell: false });
  return result.status === 0;
}

export function grantsQuestionIn(agentFile: string): boolean {
  return /^\s*question:\s*allow\s*$/m.test(agentFile);
}

export function referencedSkills(spec: ReturnType<typeof loadSpec>): string[] {
  const ids = new Set<string>();
  for (const category of spec.categories) {
    for (const skill of category.defaultSkills ?? []) ids.add(skill);
    for (const step of category.roadmap?.steps ?? []) {
      for (const skill of step.requireSkills ?? []) ids.add(skill);
    }
  }
  for (const rule of spec.rules) for (const skill of rule.require) ids.add(skill);
  for (const provider of spec.providers) if (provider.kind === "skill") ids.add(provider.id);
  return [...ids].sort();
}

export function commandDoctor(parsed: Parsed): void {
  const root = novahizHome();
  const spec = loadSpec(root);
  const checks: DoctorCheck[] = [];

  const parts = process.versions.node.split(".").map((value) => Number(value));
  const nodeOk = parts[0] > 22 || (parts[0] === 22 && parts[1] >= 18);
  checks.push({ id: "node", label: "Node 22.18+", ok: nodeOk, detail: `v${process.versions.node}`, blocking: true });
  checks.push({ id: "npx", label: "npx disponible", ok: hasCommand("npx"), detail: "requis par les providers MCP", blocking: true });

  const index = loadInstalledSkills(spec);
  checks.push({
    id: "index",
    label: "Index des skills",
    ok: index.available,
    detail: index.available ? `${index.skills.size} skills` : "build/installed-skills.json illisible, lance novahiz sync",
    blocking: true
  });

  const referenced = referencedSkills(spec);
  const absent = index.available ? referenced.filter((id) => !index.skills.has(id)) : [];
  checks.push({
    id: "referenced",
    label: "Skills referencees",
    ok: absent.length === 0,
    detail: absent.length === 0 ? `${referenced.length} presentes` : `absentes de l'index: ${absent.join(", ")}`,
    blocking: absent.length > 0
  });

  const missingCli = Object.entries(SKILL_CLI)
    .filter(([skill]) => referenced.includes(skill) && !hasCommand(skill))
    .map(([, cli]) => cli);
  checks.push({
    id: "cli",
    label: "CLI externes requises",
    ok: missingCli.length === 0,
    detail: missingCli.length === 0 ? "toutes presentes" : `introuvables: ${missingCli.join(", ")}`,
    blocking: missingCli.length > 0
  });

  const probe = evaluateGate({
    tool: "edit",
    filePath: "README.md",
    content: "texte",
    categories: [],
    loadedSkills: [],
    installedSkills: index.skills,
    installedIndexAvailable: index.available,
    spec
  });
  const gateOk = spec.rules.length > 0 && probe.allow === false && probe.missingSkills.length > 0;
  checks.push({
    id: "gate",
    label: "Gate operationnel",
    ok: gateOk,
    detail: gateOk ? `bloque une ecriture sans skill chargee (${probe.missingSkills.join(", ")})` : "n'a pas bloque une ecriture sans skill chargee",
    blocking: true
  });

  const dbFile = dbPathFor(root, spec);
  let dbOk = false;
  let dbDetail = "absente";
  try {
    const size = statSync(dbFile).size;
    const db = openDb(dbFile);
    db.prepare("SELECT COUNT(*) AS n FROM enforcement_log").get();
    db.close();
    dbOk = true;
    dbDetail = ui.bytes(size);
  } catch (error) {
    dbDetail = `illisible: ${(error as Error).message}`;
  }
  checks.push({ id: "db", label: "Base du registre", ok: dbOk, detail: dbDetail, blocking: false });

  const adapterSource = join(root, "adapters", "opencode", "novahiz.ts");
  const opencodeDir =
    process.env.OPENCODE_CONFIG_DIR && process.env.OPENCODE_CONFIG_DIR.length > 0
      ? process.env.OPENCODE_CONFIG_DIR
      : join(homedir(), ".config", "opencode");
  const adapterInstalled = join(opencodeDir, "plugins", "novahiz.ts");
  let adapterOk = true;
  let adapterDetail = "aucune copie installee";
  if (existsSync(adapterSource) && existsSync(adapterInstalled)) {
    adapterOk = readFileSync(adapterSource, "utf8") === readFileSync(adapterInstalled, "utf8");
    adapterDetail = adapterOk ? "copie harnais a jour" : "copie harnais perimee, relance l'installeur puis redemarre opencode";
  }
  checks.push({ id: "adapter", label: "Copie harnais du plugin", ok: adapterOk, detail: adapterDetail, blocking: false });

  const agentSource = join(root, "adapters", "opencode", "agent", "novahiz-agent.md");
  const agentInstalled = join(opencodeDir, "agent", "novahiz-agent.md");
  let agentOk = true;
  let agentDetail = "aucune copie installee";
  if (existsSync(agentSource) && existsSync(agentInstalled)) {
    const installed = readFileSync(agentInstalled, "utf8");
    const inSync = installed === readFileSync(agentSource, "utf8");
    const grantsQuestion = grantsQuestionIn(installed);
    agentOk = inSync && grantsQuestion;
    agentDetail = !inSync
      ? "copie harnais perimee, relance l'installeur puis redemarre opencode"
      : grantsQuestion
        ? "copie harnais a jour, question autorise"
        : "la copie harnais n'autorise pas question: le pipeline ne peut pas interroger";
  }
  checks.push({ id: "agent", label: "Copie harnais de l'agent", ok: agentOk, detail: agentDetail, blocking: false });

  const failing = checks.filter((check) => !check.ok);
  const blocking = failing.filter((check) => check.blocking);
  const value = {
    home: root,
    node: process.versions.node,
    platform: process.platform,
    checks,
    failing: failing.map((check) => check.id),
    blocking: blocking.map((check) => check.id)
  };

  emit(parsed, value, () =>
    [
      ui.heading("Novahiz doctor"),
      ui.kv([
        ["Maison", root],
        ["Plateforme", process.platform]
      ]),
      "",
      ui.table(
        ["controle", "etat", "detail"],
        checks.map((check) => [check.label, check.ok ? ui.status(true) : ui.status(false), check.detail])
      ),
      "",
      blocking.length > 0
        ? ui.style("red", `${blocking.length} anomalie(s) bloquante(s): ${blocking.map((check) => check.id).join(", ")}`)
        : ui.style("green", "Aucune anomalie bloquante.")
    ].join("\n")
  );

  if (blocking.length > 0) process.exitCode = 1;
}

