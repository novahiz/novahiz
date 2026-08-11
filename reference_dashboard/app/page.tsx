"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Activity,
  Layers,
  Database,
  RefreshCw,
  Clock,
  Code,
  FileCheck,
  AlertTriangle,
  Server,
  Zap,
  CheckCircle2,
  XCircle,
  ExternalLink,
  BookOpen,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
  Cell,
} from "recharts";

interface TelemetryData {
  success: boolean;
  timestamp: string;
  metrics: {
    totalSessions: number;
    gatePassedSessions: number;
    gateComplianceRate: number;
    totalMutations: number;
    totalLogs: number;
    passedLogs: number;
    failedLogs: number;
    logComplianceRate: number;
  };
  categoryData: { name: string; value: number }[];
  timelineData: { name: string; mutations: number; gate: number }[];
  recentSessions: any[];
  recentLogs: any[];
}

const CATEGORY_COLORS = [
  "#6366F1",
  "#06B6D4",
  "#8B5CF6",
  "#10B981",
  "#F59E0B",
  "#F43F5E",
  "#EC4899",
  "#3B82F6",
  "#14B8A6",
  "#A855F7",
  "#EAB308",
  "#64748B",
  "#0EA5E9",
];

export default function Dashboard() {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState<
    "sessions" | "logs" | "architecture"
  >("sessions");

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error("Failed to load stats", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    if (!autoRefresh) return;
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStats]);

  const metrics = data?.metrics || {
    totalSessions: 0,
    gatePassedSessions: 0,
    gateComplianceRate: 100,
    totalMutations: 0,
    totalLogs: 0,
    passedLogs: 0,
    failedLogs: 0,
    logComplianceRate: 100,
  };

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 max-w-7xl mx-auto w-full space-y-6">
      {/* Top Navbar */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-border/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-cyan-400 p-[1px] shadow-glow-primary">
            <div className="w-full h-full bg-card rounded-[11px] flex items-center justify-center">
              <Zap className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-white to-cyan-300">
                Novahiz Control Center
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 border border-emerald-500/30 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                WAL Live
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Antigravity CLI & Desktop Shared Telemetry
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            Dernière sync: {lastUpdated.toLocaleTimeString()}
          </div>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 ${
              autoRefresh
                ? "bg-indigo-950/60 border-indigo-500/40 text-indigo-300"
                : "bg-card border-border text-slate-400 hover:text-slate-200"
            }`}
          >
            <RefreshCw
              className={`w-3 h-3 ${autoRefresh ? "animate-spin" : ""}`}
            />
            {autoRefresh ? "Live (3s)" : "Pause"}
          </button>

          <button
            onClick={fetchStats}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-sm"
          >
            Rafraîchir
          </button>
        </div>
      </header>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gate Compliance Card */}
        <div className="glass-panel glass-panel-hover rounded-2xl p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Gate Compliance
            </span>
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">
              {metrics.gateComplianceRate}%
            </span>
            <span className="text-xs text-emerald-400 font-medium">
              {metrics.gatePassedSessions}/{metrics.totalSessions || 1} validées
            </span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-full transition-all duration-500"
              style={{ width: `${metrics.gateComplianceRate}%` }}
            />
          </div>
        </div>

        {/* Sessions Count Card */}
        <div className="glass-panel glass-panel-hover rounded-2xl p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Sessions Exécutées
            </span>
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">
              {metrics.totalSessions}
            </span>
            <span className="text-xs text-cyan-400 font-medium">
              Sync SQLite
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">Partagé CLI & Desktop</p>
        </div>

        {/* Total Mutations Card */}
        <div className="glass-panel glass-panel-hover rounded-2xl p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Mutations Protégées
            </span>
            <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <Code className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">
              {metrics.totalMutations}
            </span>
            <span className="text-xs text-violet-400 font-medium">
              Auto-Fix & Sweeper
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Écritures & modifications de code
          </p>
        </div>

        {/* Obsidian & Compliance Audit Card */}
        <div className="glass-panel glass-panel-hover rounded-2xl p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Audit & Obsidian Vault
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <BookOpen className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">
              {metrics.passedLogs}
            </span>
            <span className="text-xs text-emerald-400 font-medium">
              Règles conformes
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Dual-Write vers Vault activé
          </p>
        </div>
      </div>

      {/* Analytics Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Category Breakdown (2 Cols) */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-6 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                Distribution des 13 Catégories de Requêtes
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Classification automatique en amont du pipeline
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            {data?.categoryData ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.categoryData.filter((d) => d.value > 0)}
                  margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#1f2937"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    stroke="#64748b"
                    fontSize={11}
                    angle={-25}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#111827",
                      borderColor: "#374151",
                      borderRadius: "8px",
                      color: "#fff",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="value" name="Requêtes" radius={[4, 4, 0, 0]}>
                    {data.categoryData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Chargement des données...
              </div>
            )}
          </div>
        </div>

        {/* Activity & Health Stream (1 Col) */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-cyan-400" />
              Statut SQLite & Gardiens
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              État des mécanismes d'enforcement
            </p>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-border/50 text-xs">
                <span className="text-slate-300 font-medium flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  SQLite Concurrency (WAL)
                </span>
                <span className="text-emerald-400 font-semibold">Active</span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-border/50 text-xs">
                <span className="text-slate-300 font-medium flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  Security Sweeper (PreToolUse)
                </span>
                <span className="text-emerald-400 font-semibold">Armé</span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-border/50 text-xs">
                <span className="text-slate-300 font-medium flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  Prettier Auto-Fix (PostToolUse)
                </span>
                <span className="text-emerald-400 font-semibold">Armé</span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-border/50 text-xs">
                <span className="text-slate-300 font-medium flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  Obsidian Auto-Sync (Stop Hook)
                </span>
                <span className="text-emerald-400 font-semibold">Actif</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-border/40 text-[11px] text-slate-500 flex justify-between">
            <span>Chemin Vault: ~/Documents/novahiz</span>
            <span>Port: 3456</span>
          </div>
        </div>
      </div>

      {/* Tabs Section */}
      <div className="glass-panel rounded-2xl p-6">
        <div className="flex border-b border-border/60 pb-3 gap-6">
          <button
            onClick={() => setActiveTab("sessions")}
            className={`text-sm font-semibold transition pb-1 border-b-2 ${
              activeTab === "sessions"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            📋 Sessions Explorer
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`text-sm font-semibold transition pb-1 border-b-2 ${
              activeTab === "logs"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            🛡️ Live Compliance Logs
          </button>
          <button
            onClick={() => setActiveTab("architecture")}
            className={`text-sm font-semibold transition pb-1 border-b-2 ${
              activeTab === "architecture"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            🏗️ Architecture Novahiz
          </button>
        </div>

        <div className="mt-4">
          {/* Tab 1: Sessions */}
          {activeTab === "sessions" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider border-b border-border">
                  <tr>
                    <th className="py-3 px-4">Session ID</th>
                    <th className="py-3 px-4">Catégorie</th>
                    <th className="py-3 px-4">Statut Gate</th>
                    <th className="py-3 px-4">Mutations</th>
                    <th className="py-3 px-4">Dernière Activité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {data?.recentSessions && data.recentSessions.length > 0 ? (
                    data.recentSessions.map((session) => (
                      <tr
                        key={session.session_id}
                        className="hover:bg-slate-800/40 transition"
                      >
                        <td className="py-3 px-4 font-mono font-medium text-slate-200">
                          {session.session_id.substring(0, 12)}...
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-950 border border-indigo-500/30 text-indigo-300">
                            {session.request_category || "Général"}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {session.gate_passed ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-400 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5" /> PENDING
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                          {session.mutation_count || 0}
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {session.last_activity
                            ? new Date(session.last_activity).toLocaleString()
                            : "N/A"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-6 text-slate-500"
                      >
                        Aucune session enregistrée pour le moment.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 2: Logs */}
          {activeTab === "logs" && (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
              {data?.recentLogs && data.recentLogs.length > 0 ? (
                data.recentLogs.map((log: any) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-slate-900/60 border border-border/50 flex items-start justify-between gap-4 text-xs"
                  >
                    <div className="flex items-start gap-3">
                      {log.status === "PASS" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200">
                            {log.rule}
                          </span>
                          {log.tool && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
                              {log.tool}
                            </span>
                          )}
                        </div>
                        <p className="text-slate-400 text-[11px] mt-0.5">
                          {log.detail || "Vérification effectuée."}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-slate-500 text-xs">
                  Aucun log de conformité récent.
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Architecture Diagram */}
          {activeTab === "architecture" && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-border/40 space-y-4 text-xs text-slate-300">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <div className="p-4 rounded-xl bg-slate-900 border border-indigo-500/30">
                  <h3 className="font-bold text-indigo-400 mb-1">
                    1. Interception (Hooks TS)
                  </h3>
                  <p className="text-slate-400 text-[11px]">
                    PreToolUse (Sweeper, Enforcer) & PostToolUse (Auto-Fix
                    Prettier)
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900 border border-cyan-500/30">
                  <h3 className="font-bold text-cyan-400 mb-1">
                    2. Résilience SQLite WAL
                  </h3>
                  <p className="text-slate-400 text-[11px]">
                    Concurrence sans blocage partagée entre CLI, Desktop et
                    Sous-agents
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-900 border border-emerald-500/30">
                  <h3 className="font-bold text-emerald-400 mb-1">
                    3. Dual-Write Obsidian
                  </h3>
                  <p className="text-slate-400 text-[11px]">
                    Clôture de session automatique vers
                    ~/Documents/novahiz/Novahiz-Sessions
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
