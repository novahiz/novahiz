"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  ShieldAlert,
  Terminal,
  Zap,
  Lock,
  Layers,
  Database,
  FileCode2,
  CheckCircle2,
  Copy,
  Check,
  ArrowRight,
  ExternalLink,
  Sparkles,
  Cpu,
  Workflow,
  BookOpen,
  GitBranch,
  Search,
} from "lucide-react";

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<"mac" | "win" | "prompt">("mac");
  const [copied, setCopied] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number>(0);

  const installCommands = {
    mac: "curl -fsSL https://raw.githubusercontent.com/novahiz/novahiz/main/install.sh | bash",
    win: "irm https://raw.githubusercontent.com/novahiz/novahiz/main/install.ps1 | iex",
    prompt:
      "Installe le workflow universel Novahiz depuis https://github.com/novahiz/novahiz dans mon environnement.",
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const categories = [
    {
      id: "feature",
      name: "01. Feature",
      tag: "Code + Tests",
      desc: "Nouvelle fonctionnalité logicielle avec typage strict et tests",
      blocked: ["write_to_file", "replace_file_content", "run_command"],
      icon: FileCode2,
    },
    {
      id: "bugfix",
      name: "02. Bugfix",
      tag: "RCA + Fix",
      desc: "Correction de bug avec identification de cause racine et non-régression",
      blocked: ["write_to_file", "replace_file_content"],
      icon: ShieldAlert,
    },
    {
      id: "refactor",
      name: "03. Refactor",
      tag: "Clean Code",
      desc: "Refactorisation de code sans altérer le comportement fonctionnel",
      blocked: ["write_to_file", "replace_file_content"],
      icon: Workflow,
    },
    {
      id: "architecture",
      name: "04. Architecture",
      tag: "ADR & Schemas",
      desc: "Conception de systèmes distribués, schémas de données et diagrammes",
      blocked: ["Écriture directe de code"],
      icon: Layers,
    },
    {
      id: "security",
      name: "05. Security",
      tag: "SAST & CVE",
      desc: "Audits de vulnérabilités, détection de failles OWASP et secrets",
      blocked: ["Modifications directes"],
      icon: Lock,
    },
    {
      id: "devops_ci",
      name: "06. DevOps / CI",
      tag: "Docker / CI",
      desc: "Pipelines GitHub Actions, conteneurs Docker et déploiements",
      blocked: ["Commandes destructives"],
      icon: Cpu,
    },
    {
      id: "testing",
      name: "07. Testing",
      tag: "Playwright / Jest",
      desc: "Suites de tests unitaires, intégration et E2E",
      blocked: ["Altération code métier"],
      icon: CheckCircle2,
    },
    {
      id: "mobile_expo",
      name: "08. Mobile Expo",
      tag: "React Native",
      desc: "Écrans natifs iOS/Android avec respect des Apple HIG et typage strict",
      blocked: ["Modifications non typées"],
      icon: Sparkles,
    },
    {
      id: "web_ui",
      name: "09. Web & UI",
      tag: "Next.js / Tailwind",
      desc: "Interfaces modernes, palettes HSL soignées, mode sombre et micro-animations",
      blocked: ["Design générique IA"],
      icon: Zap,
    },
    {
      id: "database",
      name: "10. Database",
      tag: "Prisma / SQL",
      desc: "Modélisation relationnelle, migrations sécurisées et optimisation d'index",
      blocked: ["Commandes DROP / RAW"],
      icon: Database,
    },
    {
      id: "docs",
      name: "11. Documentation",
      tag: "OpenAPI / MD",
      desc: "Spécifications techniques, README et documentations d'architecture",
      blocked: ["Code applicatif"],
      icon: BookOpen,
    },
    {
      id: "config",
      name: "12. Config",
      tag: "MCP / Settings",
      desc: "Configuration de linters, serveurs MCP et réglages d'environnements",
      blocked: ["Écriture hors config"],
      icon: Terminal,
    },
    {
      id: "research",
      name: "13. Research",
      tag: "Read-Only",
      desc: "Recherche exploratoire, documentation et analyse comparative",
      blocked: ["Toute écriture"],
      icon: Search,
    },
  ];

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Background Gradients */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-gradient-to-tr from-cyan-600/15 via-indigo-600/15 to-purple-600/10 blur-[130px] rounded-full" />
        <div className="absolute top-1/2 -left-40 w-[600px] h-[600px] bg-cyan-600/10 blur-[140px] rounded-full" />
        <div className="absolute bottom-10 right-0 w-[500px] h-[500px] bg-purple-600/10 blur-[140px] rounded-full" />
      </div>

      {/* Navigation Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#090D16]/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-18 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 border border-white/10">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                Novahiz
              </span>
              <span className="text-[10px] uppercase font-mono tracking-widest text-cyan-400">
                Deterministic Agent Engine
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
            <a
              href="#features"
              className="hover:text-cyan-400 transition-colors"
            >
              Piliers
            </a>
            <a
              href="#categories"
              className="hover:text-cyan-400 transition-colors"
            >
              13 Catégories
            </a>
            <a
              href="#architecture"
              className="hover:text-cyan-400 transition-colors"
            >
              Architecture
            </a>
            <a
              href="#installation"
              className="hover:text-cyan-400 transition-colors"
            >
              Installation
            </a>
          </nav>

          <div className="flex items-center gap-4">
            <a
              href="https://github.com/novahiz/novahiz"
              target="_blank"
              rel="noreferrer"
              className="p-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 transition-all"
            >
              <GitBranch className="h-4 w-4" />
            </a>
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-sm font-semibold shadow-lg shadow-cyan-500/20 hover:brightness-110 transition-all"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Console Live
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-24 pb-20 px-6 max-w-7xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-xs font-mono mb-8 backdrop-blur-md">
          <Sparkles className="h-3.5 w-3.5" />
          <span>NOVAHIZ 1.0 — ZERO SIMULATION EXECUTION</span>
        </div>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight max-w-4xl mx-auto leading-[1.1] mb-6">
          L'Assistant IA qui{" "}
          <span className="bg-gradient-to-r from-cyan-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
            n'invente jamais de code
          </span>
          .
        </h1>

        <p className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed mb-10">
          Transformez votre assistant IA (Antigravity, Claude Code, OpenCode,
          Cursor) en un ingénieur logiciel déterministe avec{" "}
          <strong>hooks d'interception stricts</strong>,{" "}
          <strong>sécurité anti-fuite de clés</strong> et{" "}
          <strong>mémoire persistante</strong>.
        </p>

        {/* 1-Click Interactive Installation Box */}
        <div
          id="installation"
          className="max-w-2xl mx-auto rounded-2xl border border-white/10 bg-slate-900/90 backdrop-blur-2xl p-6 shadow-2xl shadow-cyan-950/40 text-left mb-16"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
            <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
              <Terminal className="h-4 w-4 text-cyan-400" />
              <span>INSTALLATION 1-CLICK</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab("mac")}
                className={`px-3 py-1 text-xs font-mono rounded-lg transition-all ${
                  activeTab === "mac"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                macOS / Linux
              </button>
              <button
                onClick={() => setActiveTab("win")}
                className={`px-3 py-1 text-xs font-mono rounded-lg transition-all ${
                  activeTab === "win"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Windows (PS)
              </button>
              <button
                onClick={() => setActiveTab("prompt")}
                className={`px-3 py-1 text-xs font-mono rounded-lg transition-all ${
                  activeTab === "prompt"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Prompt IA
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 bg-black/50 border border-white/5 rounded-xl p-4 font-mono text-xs sm:text-sm text-cyan-300 overflow-x-auto">
            <span className="truncate">{installCommands[activeTab]}</span>
            <button
              onClick={() => handleCopy(installCommands[activeTab])}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-sans text-xs transition-all shrink-0"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copied ? "Copié !" : "Copier"}</span>
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 font-mono">
            <span>✨ Détecte automatiquement l'OS et les IA installées</span>
            <span>Licence MIT</span>
          </div>
        </div>

        {/* Compatibility Pills */}
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-slate-400 font-mono">
          <span className="text-slate-500">100% Compatible avec :</span>
          <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
            Google Antigravity
          </span>
          <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
            Claude Code
          </span>
          <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
            OpenCode / Codex
          </span>
          <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
            Cursor IDE
          </span>
        </div>
      </section>

      {/* The 6 Core Pillars */}
      <section
        id="features"
        className="py-20 px-6 max-w-7xl mx-auto border-t border-white/5"
      >
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-xs uppercase font-mono tracking-widest text-cyan-400 mb-3">
            Piliers Technologiques
          </h2>
          <h3 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Une architecture conçue pour la rigueur absolue.
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              icon: ShieldCheck,
              title: "Gate Enforcer Prévérifié",
              desc: "Bloque toute modification de fichier ou commande tant que la catégorie n'est pas identifiée et le plan atomique validé.",
              color: "from-cyan-500/20 to-blue-500/20",
              border: "group-hover:border-cyan-500/40",
            },
            {
              icon: Lock,
              title: "Security Sweeper Temps Réel",
              desc: "Intercepteur PreToolUse qui analyse le code et bloque net toute fuite de clés API (AWS, OpenAI, GitHub PAT, Anthropic).",
              color: "from-purple-500/20 to-pink-500/20",
              border: "group-hover:border-purple-500/40",
            },
            {
              icon: Layers,
              title: "Matrice des 13 Catégories",
              desc: "Politique d'isolation stricte des outils : une tâche de documentation ne peut jamais toucher à la logique métier.",
              color: "from-indigo-500/20 to-cyan-500/20",
              border: "group-hover:border-indigo-500/40",
            },
            {
              icon: Zap,
              title: "Auto-Fixer & Prettier",
              desc: "Formate instantanément en tâche de fond chaque fichier TypeScript, CSS ou JSON modifié dès que l'agent a terminé l'écriture.",
              color: "from-amber-500/20 to-orange-500/20",
              border: "group-hover:border-amber-500/40",
            },
            {
              icon: Database,
              title: "Télémétrie SQLite WAL",
              desc: "Historisation ultra-rapide et non-bloquante de chaque session, mutation et événement de conformité en mode Write-Ahead Logging.",
              color: "from-emerald-500/20 to-teal-500/20",
              border: "group-hover:border-emerald-500/40",
            },
            {
              icon: BookOpen,
              title: "Mémoire Dual-Write Obsidian",
              desc: "Génération automatique d'un rapport de session structuré avec YAML Frontmatter dans votre coffre Obsidian local.",
              color: "from-blue-500/20 to-indigo-500/20",
              border: "group-hover:border-blue-500/40",
            },
          ].map((pillar, i) => (
            <div
              key={i}
              className={`group relative p-8 rounded-2xl border border-white/10 bg-slate-900/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 ${pillar.border}`}
            >
              <div
                className={`h-12 w-12 rounded-xl bg-gradient-to-br ${pillar.color} flex items-center justify-center mb-6 border border-white/10`}
              >
                <pillar.icon className="h-6 w-6 text-white" />
              </div>
              <h4 className="text-xl font-semibold text-white mb-2">
                {pillar.title}
              </h4>
              <p className="text-sm text-slate-400 leading-relaxed">
                {pillar.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Interactive 13 Categories Matrix */}
      <section
        id="categories"
        className="py-20 px-6 max-w-7xl mx-auto border-t border-white/5"
      >
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-xs uppercase font-mono tracking-widest text-cyan-400 mb-3">
            Isolation & Sécurité
          </h2>
          <h3 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            La Matrice des 13 Catégories de Requêtes
          </h3>
          <p className="text-slate-400 text-sm mt-3">
            Cliquez sur une catégorie pour inspecter ses règles de restriction
            d'outils appliquées par le Gate.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Categories List */}
          <div className="lg:col-span-5 flex flex-col gap-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {categories.map((cat, i) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(i)}
                className={`flex items-center justify-between p-3.5 rounded-xl border text-left font-mono text-xs transition-all ${
                  selectedCategory === i
                    ? "border-cyan-500/50 bg-cyan-500/10 text-white shadow-lg shadow-cyan-500/10"
                    : "border-white/5 bg-slate-900/40 text-slate-400 hover:border-white/10 hover:text-slate-200"
                }`}
              >
                <div className="flex items-center gap-3">
                  <cat.icon
                    className={`h-4 w-4 ${selectedCategory === i ? "text-cyan-400" : "text-slate-500"}`}
                  />
                  <span className="font-semibold">{cat.name}</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400">
                  {cat.tag}
                </span>
              </button>
            ))}
          </div>

          {/* Selected Category Detail Card */}
          <div className="lg:col-span-7 rounded-2xl border border-cyan-500/30 bg-slate-900/80 backdrop-blur-2xl p-8 shadow-xl shadow-cyan-950/30">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                  {React.createElement(categories[selectedCategory].icon, {
                    className: "h-5 w-5 text-cyan-300",
                  })}
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white">
                    {categories[selectedCategory].name}
                  </h4>
                  <span className="text-xs text-cyan-400 font-mono">
                    Catégorie ID: #{categories[selectedCategory].id}
                  </span>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-mono text-xs">
                {categories[selectedCategory].tag}
              </span>
            </div>

            <p className="text-slate-300 text-sm leading-relaxed mb-6">
              {categories[selectedCategory].desc}
            </p>

            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 mb-6">
              <div className="flex items-center gap-2 text-xs font-mono text-red-400 mb-2 font-semibold">
                <ShieldAlert className="h-4 w-4" />
                <span>OUTILS STRICTEMENT BLOQUÉS AVANT GATE PASS :</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {categories[selectedCategory].blocked.map((b, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded bg-black/40 border border-red-500/30 text-red-300 font-mono text-xs"
                  >
                    🚫 {b}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-mono text-slate-400 border-t border-white/5 pt-4">
              <span>Validation par hook d'interception natif</span>
              <span className="text-cyan-400">Gate : PASS requis</span>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison: Standard AI vs Novahiz */}
      <section className="py-20 px-6 max-w-7xl mx-auto border-t border-white/5">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-xs uppercase font-mono tracking-widest text-cyan-400 mb-3">
            La Différence Novahiz
          </h2>
          <h3 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Pourquoi les assistants classiques échouent.
          </h3>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/10">
            <div className="p-8">
              <div className="flex items-center gap-2 text-red-400 font-mono text-xs font-semibold mb-6">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span>ASSISTANT IA CLASSIQUE</span>
              </div>
              <ul className="space-y-4 text-sm text-slate-400">
                <li className="flex items-start gap-3">
                  <span className="text-red-400 shrink-0">✕</span>
                  <span>
                    Modifie des fichiers à l'aveugle sans plan atomique
                    préalable
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-red-400 shrink-0">✕</span>
                  <span>
                    Risque d'écrire des tokens ou clés API en dur dans le code
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-red-400 shrink-0">✕</span>
                  <span>
                    Produit des designs d'IA génériques (violet criard, cartes
                    identiques)
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-red-400 shrink-0">✕</span>
                  <span>
                    Perd toute trace des décisions d'architecture après la
                    session
                  </span>
                </li>
              </ul>
            </div>

            <div className="p-8 bg-cyan-950/20">
              <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs font-semibold mb-6">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                <span>AVEC LE WORKFLOW NOVAHIZ</span>
              </div>
              <ul className="space-y-4 text-sm text-slate-200">
                <li className="flex items-start gap-3">
                  <span className="text-cyan-400 shrink-0">✓</span>
                  <span>
                    <strong>Gate Enforcer</strong> : écriture bloquée jusqu'à
                    validation formelle du plan
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-cyan-400 shrink-0">✓</span>
                  <span>
                    <strong>Security Sweeper</strong> : blocage immédiat des
                    fuites d'identifiants sensibles
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-cyan-400 shrink-0">✓</span>
                  <span>
                    <strong>Design Impeccable</strong> : palettes HSL calibrées,
                    dark mode et animations fluides
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-cyan-400 shrink-0">✓</span>
                  <span>
                    <strong>Dual-Write Memory</strong> : synchronisation SQLite
                    WAL + coffre Obsidian
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6 max-w-5xl mx-auto text-center border-t border-white/5">
        <div className="rounded-3xl border border-cyan-500/30 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-12 backdrop-blur-2xl relative overflow-hidden shadow-2xl shadow-cyan-950/50">
          <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
          <h3 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
            Prêt à fiabiliser vos agents IA ?
          </h3>
          <p className="text-slate-400 max-w-xl mx-auto text-sm sm:text-base mb-8">
            Installez Novahiz en une commande et offrez une discipline de
            production industrielle à votre environnement de développement.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href="#installation"
              className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-semibold text-sm shadow-lg shadow-cyan-500/25 hover:brightness-110 transition-all flex items-center gap-2"
            >
              <span>Installer Novahiz Maintenant</span>
              <ArrowRight className="h-4 w-4" />
            </a>
            <Link
              href="/dashboard"
              className="px-6 py-3.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 font-semibold text-sm transition-all"
            >
              Voir la Console en Direct
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 max-w-7xl mx-auto border-t border-white/5 text-center text-xs text-slate-500 font-mono">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span>© 2026 Novahiz — Deterministic Agent Engine</span>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/novahiz/novahiz"
              target="_blank"
              rel="noreferrer"
              className="hover:text-cyan-400 transition-colors"
            >
              GitHub Repository
            </a>
            <Link
              href="/dashboard"
              className="hover:text-cyan-400 transition-colors"
            >
              Live Telemetry Dashboard
            </Link>
            <span>Licence MIT</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
