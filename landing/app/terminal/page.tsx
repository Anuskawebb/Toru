"use client";

import React, { useState, useEffect, useRef } from "react";
import { ToroMark } from "../page";

// ── Inlined Icons (SVG) for layout ───────────────────────────────────────────
const DashboardIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
    <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
  </svg>
);

const MarketsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
  </svg>
);

const PortfolioIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);

const AgentIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2z" />
    <path d="M12 6v6l4 2" />
  </svg>
);

const CommunityIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const NewsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <path d="M16 8h2m-2 4h2M6 8h6m-6 4h6m-6 4h10" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.5 1z" />
  </svg>
);

// ── Types & Mock Data ────────────────────────────────────────────────────────
interface SmartMoneySignal {
  id: string;
  address: string;
  alias: string;
  winRate: number;
  trades24h: number;
  avgReturn: number;
  isTracking: boolean;
}

interface Opportunity {
  token: string;
  score: number;
  liquidity: string;
  priceMnt: string;
  trend: "up" | "down" | "flat";
  recommendation: string;
}

interface OpenPosition {
  id: string;
  token: string;
  leader: string;
  entryPrice: number;
  currentPrice: number;
  sizeUsd: number;
  pnl: number;
}

interface LogEntry {
  time: string;
  tag: string;
  msg: string;
}

export default function TerminalPage() {
  const [activeTab, setActiveTab] = useState<string>("Dashboard");

  // Onboarding modal states
  const [showOnboarding, setShowOnboarding] = useState<boolean>(true);

  // Live telemetry logs state
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: "16:40:01", tag: "SYS", msg: "Toru Agent Framework initialized." },
    { time: "16:40:03", tag: "CONN", msg: "Listening to Mantle Sepolia Node (Chain ID 5003)." },
    { time: "16:40:05", tag: "WATCHER", msg: "Monitoring Agni swap pools & Smart Money address lists..." },
    { time: "16:40:08", tag: "HEARTBEAT", msg: "Heartbeat status: active [latency: 35ms]" },
  ]);

  // Active agents state
  const [agents, setAgents] = useState([
    { id: "1", name: "Vega Quant Copier", leader: "0xVega", mode: "Autonomous Trading", status: true, wallet: "4,500.00" },
    { id: "2", name: "Nova Swing Shield", leader: "0xNova", mode: "Assisted Trading", status: false, wallet: "1,200.00" },
  ]);

  // Create Agent Wizard States
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [newAgentLeader, setNewAgentLeader] = useState<string>("");
  const [newAgentName, setNewAgentName] = useState<string>("");
  const [newAgentMode, setNewAgentMode] = useState<string>("Autonomous Trading");
  const [newAgentFunding, setNewAgentFunding] = useState<string>("1000");
  const [newAgentMaxTrade, setNewAgentMaxTrade] = useState<number>(200);
  const [newAgentStopLoss, setNewAgentStopLoss] = useState<number>(15);

  // Portfolio states
  const [portfolioValue, setPortfolioValue] = useState<number>(142500);
  const [unrealizedPnl, setUnrealizedPnl] = useState<number>(3250);
  const [cashReserve, setCashReserve] = useState<number>(42480);
  const [exposure, setExposure] = useState<number>(100020);
  const [drawdown, setDrawdown] = useState<number>(0.8);
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([
    { id: "pos-1", token: "WETH", leader: "0xVega", entryPrice: 3450.25, currentPrice: 3485.60, sizeUsd: 45000, pnl: 460 },
    { id: "pos-2", token: "WMNT", leader: "0xVega", entryPrice: 1.15, currentPrice: 1.18, sizeUsd: 25000, pnl: 650 },
    { id: "pos-3", token: "USDC", leader: "0xNova", entryPrice: 1.00, currentPrice: 1.001, sizeUsd: 30020, pnl: 30 },
  ]);

  // Smart Money Signals state
  const [signals, setSignals] = useState<SmartMoneySignal[]>([
    { id: "sig-1", address: "0x5340...1f8a", alias: "Vega Quant", winRate: 94.2, trades24h: 12, avgReturn: 4.8, isTracking: true },
    { id: "sig-2", address: "0x892a...c029", alias: "0xNova", winRate: 89.5, trades24h: 6, avgReturn: 3.5, isTracking: true },
    { id: "sig-3", address: "0x3bc1...e301", alias: "satoshi.eth", winRate: 83.1, trades24h: 3, avgReturn: 2.1, isTracking: false },
    { id: "sig-4", address: "0xee21...fa92", alias: "Alpha Whale", winRate: 78.4, trades24h: 8, avgReturn: 1.8, isTracking: false },
  ]);

  // Opportunity Scanner state
  const [opportunities, setOpportunities] = useState<Opportunity[]>([
    { token: "WETH", score: 88, liquidity: "$2.4M", priceMnt: "2,950 MNT", trend: "up", recommendation: "Deploy Agent Vault" },
    { token: "WMNT", score: 76, liquidity: "$1.1M", priceMnt: "1.00 MNT", trend: "flat", recommendation: "Configure Guardrails" },
    { token: "WBTC", score: 92, liquidity: "$4.8M", priceMnt: "85,600 MNT", trend: "up", recommendation: "Activate Agent" },
    { token: "USDC", score: 45, liquidity: "$10.5M", priceMnt: "1.20 MNT", trend: "flat", recommendation: "Ignore / Low Vol" },
  ]);

  // Chat/Market discussions state
  const [chatMessages, setChatMessages] = useState([
    { user: "QuantTrader_1", text: "Vega just opened a long in WMNT on Agni Finance.", time: "16:41" },
    { user: "ToroAgent_Bot", text: "Risk checks passed. Auto-executed mirroring on Sepolia.", time: "16:41" },
    { user: "MantleMaxi", text: "Is the daily stop-loss guardrail working well?", time: "16:42" },
    { user: "QuantTrader_2", text: "Yeah, hit my -10% safety cap on PEPE yesterday. Closed immediately.", time: "16:43" },
  ]);
  const [chatInput, setChatInput] = useState("");

  // Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auto ticking values & log streaming simulations
  useEffect(() => {
    const interval = setInterval(() => {
      // Tick market prices / Portfolio values slightly
      setOpenPositions((prev) =>
        prev.map((pos) => {
          const delta = (Math.random() - 0.48) * (pos.entryPrice * 0.002);
          const current = Math.max(0.1, pos.currentPrice + delta);
          const pnlDelta = (current - pos.entryPrice) * (pos.sizeUsd / pos.entryPrice);
          return {
            ...pos,
            currentPrice: Number(current.toFixed(4)),
            pnl: Number(pnlDelta.toFixed(2)),
          };
        })
      );

      // Random Opportunity Scanner update
      setOpportunities((prev) =>
        prev.map((opt) => {
          const deltaScore = Math.floor((Math.random() - 0.5) * 4);
          return {
            ...opt,
            score: Math.min(100, Math.max(0, opt.score + deltaScore)),
          };
        })
      );

      // Add a simulated telemetric log
      const logTemplates = [
        "Watcher scanned Agni liquidity pool for swap transactions...",
        "Smart Money Signal 0xVega detected: Swapped 10,000 MNT -> USDC",
        "Agent [Vega Quant Copier] evaluated swap: Score 92/100. Trade recommended.",
        "On-chain position check: Portfolio stop-loss verified. Safe margin.",
        "Telemetry heartbeat: Keepers operating within gas limits (12 Gwei).",
      ];
      const randomLog = logTemplates[Math.floor(Math.random() * logTemplates.length)];
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
      setLogs((prev) => [...prev.slice(-20), { time: timeStr, tag: "AGENT", msg: randomLog }]);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleTrackSignal = (id: string) => {
    setSignals((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          const state = !s.isTracking;
          triggerToast(`${state ? "Tracking" : "Stopped tracking"} smart money signal ${s.alias}`);
          return { ...s, isTracking: state };
        }
        return s;
      })
    );
  };

  const handleClosePosition = (id: string, token: string) => {
    setOpenPositions((prev) => prev.filter((p) => p.id !== id));
    triggerToast(`Manually closed ${token} position. Realized PnL settled.`);
  };

  const handleCreateAgent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentLeader || !newAgentName) {
      triggerToast("Please fill out the leader address and agent name.");
      return;
    }
    const newAgent = {
      id: String(agents.length + 1),
      name: newAgentName,
      leader: newAgentLeader,
      mode: newAgentMode,
      status: true,
      wallet: Number(newAgentFunding).toLocaleString("en-US", { minimumFractionDigits: 2 }),
    };
    setAgents((prev) => [...prev, newAgent]);
    triggerToast(`Agent "${newAgentName}" successfully funded and activated!`);
    // Reset wizard
    setWizardStep(1);
    setNewAgentLeader("");
    setNewAgentName("");
    setNewAgentFunding("1000");
  };

  const handleToggleAgent = (id: string, name: string) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id === id) {
          const nextState = !a.status;
          triggerToast(`Agent "${name}" ${nextState ? "activated" : "deactivated"}.`);
          return { ...a, status: nextState };
        }
        return a;
      })
    );
  };

  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    setChatMessages((prev) => [...prev, { user: "User_Trader", text: chatInput, time: timeStr }]);
    setChatInput("");
  };

  return (
    <div className="terminal-root">
      {/* ── Toast Notification ── */}
      {toastMessage && (
        <div className="terminal-toast">
          <div className="terminal-toast-inner">
            <span className="toast-icon">✓</span>
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      {/* ── Onboarding Flow Overlay ── */}
      {showOnboarding && (
        <div className="onboarding-overlay">
          <div className="onboarding-card">
            <div className="onboarding-logo-wrapper">
              <ToroMark size={64} className="text-color-green" />
            </div>
            <h2>Welcome to Toru Terminal</h2>
            <p>
              Toru is an institutional-grade, AI-powered autonomous trading platform. 
              Configure custom guardrails, track smart money wallets, and deploy automated trading agents executing 24/7 on Mantle.
            </p>
            <div className="onboarding-steps">
              <div className="onboarding-step">
                <span className="step-num">1</span>
                <div>
                  <h4>Track Smart Money</h4>
                  <p>Follow wallets with high historical win-rates.</p>
                </div>
              </div>
              <div className="onboarding-step">
                <span className="step-num">2</span>
                <div>
                  <h4>Set Custom Guardrails</h4>
                  <p>Configure daily stop-losses & transaction size ceilings.</p>
                </div>
              </div>
              <div className="onboarding-step">
                <span className="step-num">3</span>
                <div>
                  <h4>Deploy AI Agents</h4>
                  <p>Let agents score opportunities and copy swaps autonomously.</p>
                </div>
              </div>
            </div>
            <button onClick={() => setShowOnboarding(false)} className="onboarding-btn">
              Access Terminal
            </button>
          </div>
        </div>
      )}

      {/* ── Sidebar Navigation ── */}
      <aside className="terminal-sidebar">
        <div className="sidebar-brand">
          <ToroMark size={28} className="text-color-green" />
          <span className="sidebar-brand-text">Toru</span>
          <span className="sidebar-brand-badge">Terminal</span>
        </div>

        <nav className="sidebar-nav">
          {[
            { name: "Dashboard", Icon: DashboardIcon },
            { name: "Markets", Icon: MarketsIcon },
            { name: "Portfolio", Icon: PortfolioIcon },
            { name: "Agent", Icon: AgentIcon },
            { name: "Community", Icon: CommunityIcon },
            { name: "News", Icon: NewsIcon },
            { name: "Settings", Icon: SettingsIcon },
          ].map((item) => {
            const Icon = item.Icon;
            const isActive = activeTab === item.name;
            return (
              <button
                key={item.name}
                onClick={() => setActiveTab(item.name)}
                className={`nav-item${isActive ? " is-active" : ""}`}
              >
                <span className="nav-item-icon"><Icon /></span>
                <span className="nav-item-text">{item.name}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="network-indicator">
            <span className="indicator-dot blinking" />
            <span className="indicator-text">Mantle Sepolia [5003]</span>
          </div>
        </div>
      </aside>

      {/* ── Main View Container ── */}
      <main className="terminal-viewport">
        {/* ── Header Bar ── */}
        <header className="viewport-header">
          <div className="header-breadcrumbs">
            <span className="crumb-parent">Toru</span>
            <span className="crumb-separator">/</span>
            <span className="crumb-current">{activeTab}</span>
          </div>
          <div className="header-status">
            <div className="status-metric">
              <span className="status-label">Agent State:</span>
              <span className="status-val text-color-green font-semibold">ACTIVE</span>
            </div>
            <div className="status-separator" />
            <div className="status-metric">
              <span className="status-label">Heartbeat:</span>
              <span className="status-val font-mono">12s</span>
            </div>
            <div className="status-separator" />
            <button onClick={() => setShowOnboarding(true)} className="help-button">
              Guide
            </button>
          </div>
        </header>

        {/* ── Views Router ── */}
        <div className="viewport-content">
          {/* 1. DASHBOARD VIEW */}
          {activeTab === "Dashboard" && (
            <div className="dashboard-grid">
              {/* Quick Metrics Grid */}
              <div className="metrics-row">
                {[
                  { label: "Portfolio Value", value: `$${portfolioValue.toLocaleString()}`, change: "+2.28%", up: true },
                  { label: "Smart Money Signals", value: `${signals.filter(s => s.isTracking).length} Tracking`, change: "4 Monitored", up: true },
                  { label: "Scanner Activity", value: "Scanning Pools", change: "Agni V2 / V3", up: true },
                  { label: "Active Guardrails", value: "3 Configured", change: "Stop-Loss Enabled", up: true },
                ].map((m, idx) => (
                  <div className="metric-box" key={idx}>
                    <span className="box-label">{m.label}</span>
                    <div className="box-value-row">
                      <span className="box-value">{m.value}</span>
                      <span className={`box-change ${m.up ? "text-color-green" : "text-color-red"}`}>{m.change}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Main Content Columns */}
              <div className="dashboard-columns">
                <div className="left-column">
                  {/* Smart Money Signals Panel */}
                  <div className="panel-card">
                    <div className="panel-card-head">
                      <h3 className="panel-title">Smart Money Signals</h3>
                      <span className="panel-subtitle">Addresses monitored on Mantle mainnet</span>
                    </div>
                    <div className="panel-table-wrapper">
                      <table className="panel-table">
                        <thead>
                          <tr>
                            <th>Address</th>
                            <th>Win Rate</th>
                            <th>24h Swaps</th>
                            <th>Avg Profit</th>
                            <th className="text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {signals.map((sig) => (
                            <tr key={sig.id}>
                              <td className="font-mono text-sm">
                                <span className="text-color-green">{sig.alias}</span>{" "}
                                <span className="text-gray-500 font-normal">({sig.address})</span>
                              </td>
                              <td className="font-semibold">{sig.winRate}%</td>
                              <td>{sig.trades24h}</td>
                              <td className="text-color-green">+{sig.avgReturn}%</td>
                              <td className="text-right">
                                <button
                                  onClick={() => handleTrackSignal(sig.id)}
                                  className={`table-btn${sig.isTracking ? " tracking" : ""}`}
                                >
                                  {sig.isTracking ? "Untrack" : "Track"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Opportunity Scanner Panel */}
                  <div className="panel-card mt-6">
                    <div className="panel-card-head">
                      <h3 className="panel-title">Opportunity Scanner</h3>
                      <span className="panel-subtitle">Real-time candidate swaps evaluation</span>
                    </div>
                    <div className="panel-table-wrapper">
                      <table className="panel-table">
                        <thead>
                          <tr>
                            <th>Asset</th>
                            <th>AI Score</th>
                            <th>Liquidity</th>
                            <th>Price (MNT)</th>
                            <th>Action Recommendation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {opportunities.map((opt, idx) => (
                            <tr key={idx}>
                              <td className="font-bold">{opt.token}</td>
                              <td>
                                <span
                                  className={`score-badge ${
                                    opt.score > 80
                                      ? "high"
                                      : opt.score > 60
                                      ? "medium"
                                      : "low"
                                  }`}
                                >
                                  {opt.score}/100
                                </span>
                              </td>
                              <td>{opt.liquidity}</td>
                              <td className="font-mono text-sm">{opt.priceMnt}</td>
                              <td>
                                <span className="font-semibold text-color-green">{opt.recommendation}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="right-column">
                  {/* Intelligence Feed Panel */}
                  <div className="panel-card">
                    <div className="panel-card-head">
                      <h3 className="panel-title">Intelligence Feed</h3>
                      <span className="panel-subtitle">AI Trade scorer explanations</span>
                    </div>
                    <div className="intel-feed">
                      <div className="intel-card">
                        <div className="intel-header">
                          <span className="intel-token">WETH Mirror</span>
                          <span className="intel-time font-mono">16:41:20</span>
                        </div>
                        <p className="intel-body">
                          0xVega swapped 15 ETH ($52k USD) on FusionX AMM. Scored <strong>88/100</strong>. Freshness factor +10. Free vault capacity allows full size mirroring. 
                        </p>
                        <div className="intel-status text-color-green">✔ MIRRORED SUCCESSFULLY</div>
                      </div>

                      <div className="intel-card warning">
                        <div className="intel-header">
                          <span className="intel-token text-color-red">PEPE Skip</span>
                          <span className="intel-time font-mono">16:38:05</span>
                        </div>
                        <p className="intel-body">
                          Whale Address swapped $1,200 PEPE on Agni. Scored <strong>45/100</strong>. Blocked by custom guardrail: asset is not in vault allowlist.
                        </p>
                        <div className="intel-status text-color-red">✗ BLOCKED BY GUARDRAILS</div>
                      </div>
                    </div>
                  </div>

                  {/* Telemetry Agent Activity logs */}
                  <div className="panel-card mt-6">
                    <div className="panel-card-head">
                      <h3 className="panel-title">Agent Activity Log</h3>
                      <span className="panel-subtitle">Real-time terminal execution output</span>
                    </div>
                    <div className="log-console">
                      {logs.map((log, index) => (
                        <div className="log-line" key={index}>
                          <span className="log-time">[{log.time}]</span>{" "}
                          <span className={`log-tag ${log.tag.toLowerCase()}`}>[{log.tag}]</span>{" "}
                          <span className="log-msg">{log.msg}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2. MARKETS VIEW */}
          {activeTab === "Markets" && (
            <div className="markets-grid">
              <div className="panel-card">
                <div className="panel-card-head">
                  <h3 className="panel-title">Hot Markets</h3>
                  <span className="panel-subtitle">Interactive token pairs on Mantle Sepolia</span>
                </div>
                <div className="panel-table-wrapper">
                  <table className="panel-table">
                    <thead>
                      <tr>
                        <th>Asset Pair</th>
                        <th>Price (tUSD)</th>
                        <th>24h Change</th>
                        <th>24h Volume</th>
                        <th>Trend</th>
                        <th>Trade Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { pair: "WETH / tUSD", price: "3,485.60", change: "+1.85%", vol: "$12.4M", trend: "up", token: "WETH" },
                        { pair: "WMNT / tUSD", price: "1.1820", change: "+3.42%", vol: "$5.1M", trend: "up", token: "WMNT" },
                        { pair: "WBTC / tUSD", price: "95,650.00", change: "-0.24%", vol: "$24.8M", trend: "down", token: "WBTC" },
                        { pair: "USDC / tUSD", price: "1.0005", change: "+0.01%", vol: "$18.5M", trend: "flat", token: "USDC" },
                      ].map((item, idx) => (
                        <tr key={idx}>
                          <td className="font-bold">{item.pair}</td>
                          <td className="font-mono">{item.price}</td>
                          <td className={item.change.startsWith("+") ? "text-color-green" : "text-color-red"}>
                            {item.change}
                          </td>
                          <td>{item.vol}</td>
                          <td className="text-sm font-semibold uppercase">
                            <span className={item.trend === "up" ? "text-color-green" : item.trend === "down" ? "text-color-red" : "text-gray-500"}>
                              {item.trend}
                            </span>
                          </td>
                          <td>
                            <button
                              onClick={() => {
                                setActiveTab("Agent");
                                setWizardStep(1);
                                setNewAgentLeader("0xVega");
                                setNewAgentName(`${item.token} Copier`);
                              }}
                              className="action-btn"
                            >
                              Deploy Agent
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Trade Recommendations */}
              <div className="panel-card mt-6">
                <div className="panel-card-head">
                  <h3 className="panel-title">Trade Recommendations</h3>
                  <span className="panel-subtitle">AI strategist recommended setups</span>
                </div>
                <div className="recommendations-list">
                  {[
                    { token: "WETH", size: "15% of Free Reserve", reason: "Smart money signal density is rising on Agni pools. Win rate probability 92.4%.", score: 88 },
                    { token: "WMNT", size: "10% of Free Reserve", reason: "Mantle treasury flows tracking shows heavy accumulation. Score threshold passed.", score: 76 },
                  ].map((r, i) => (
                    <div className="recommendation-card" key={i}>
                      <div className="rec-badge">Score {r.score}/100</div>
                      <div className="rec-details">
                        <h4>Buy {r.token} — Recommended size {r.size}</h4>
                        <p>{r.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 3. PORTFOLIO VIEW */}
          {activeTab === "Portfolio" && (
            <div className="portfolio-grid">
              {/* Portfolio stats cards */}
              <div className="portfolio-stats">
                {[
                  { label: "Portfolio Value", value: `$${portfolioValue.toLocaleString()}` },
                  { label: "Unrealized P&L", value: `+$${unrealizedPnl.toLocaleString()}`, color: "text-color-green" },
                  { label: "Realized P&L", value: "+$18,920.00", color: "text-color-green" },
                  { label: "Cash Reserve", value: `$${cashReserve.toLocaleString()}` },
                  { label: "Exposure", value: `$${exposure.toLocaleString()}` },
                  { label: "Drawdown", value: `${drawdown}%` },
                ].map((stat, i) => (
                  <div className="stat-card" key={i}>
                    <span className="stat-card-label">{stat.label}</span>
                    <span className={`stat-card-val ${stat.color ?? ""}`}>{stat.value}</span>
                  </div>
                ))}
              </div>

              <div className="portfolio-columns">
                {/* Open Positions List */}
                <div className="positions-card">
                  <div className="panel-card-head">
                    <h3 className="panel-title">Open Positions</h3>
                    <span className="panel-subtitle">Currently active copy-trades from leader wallets</span>
                  </div>
                  <div className="panel-table-wrapper">
                    <table className="panel-table">
                      <thead>
                        <tr>
                          <th>Asset</th>
                          <th>Leader Wallet</th>
                          <th>Entry Price</th>
                          <th>Mark Price</th>
                          <th>Allocated Size</th>
                          <th>Unrealized P&L</th>
                          <th className="text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openPositions.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-center text-gray-500 py-8">
                              No open positions. Active agents will copy trades here.
                            </td>
                          </tr>
                        ) : (
                          openPositions.map((pos) => (
                            <tr key={pos.id}>
                              <td className="font-bold">{pos.token}</td>
                              <td className="font-mono text-sm">{pos.leader}</td>
                              <td className="font-mono">${pos.entryPrice.toFixed(2)}</td>
                              <td className="font-mono">${pos.currentPrice.toFixed(2)}</td>
                              <td>${pos.sizeUsd.toLocaleString()}</td>
                              <td className={`font-semibold ${pos.pnl >= 0 ? "text-color-green" : "text-color-red"}`}>
                                {pos.pnl >= 0 ? "+" : ""}${pos.pnl}
                              </td>
                              <td className="text-right">
                                <button
                                  onClick={() => handleClosePosition(pos.id, pos.token)}
                                  className="close-position-btn"
                                >
                                  Close
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Risk Controls */}
                <div className="risk-card">
                  <div className="panel-card-head">
                    <h3 className="panel-title">Risk Controls</h3>
                    <span className="panel-subtitle">Configure agent guardrails & risk levels</span>
                  </div>
                  <div className="risk-form">
                    <div className="form-group">
                      <label className="form-label">
                        <span>Max Trade Size (tUSD)</span>
                        <span className="font-mono">$2,500</span>
                      </label>
                      <input type="range" className="form-range" min="100" max="5000" defaultValue="2500" />
                    </div>

                    <div className="form-group mt-4">
                      <label className="form-label">
                        <span>Daily Loss Limit (tUSD)</span>
                        <span className="font-mono">$500</span>
                      </label>
                      <input type="range" className="form-range" min="50" max="2000" defaultValue="500" />
                    </div>

                    <div className="form-group mt-4">
                      <label className="form-label">
                        <span>Max Drawdown Discretionary Close</span>
                        <span className="font-mono">15%</span>
                      </label>
                      <input type="range" className="form-range" min="5" max="30" defaultValue="15" />
                    </div>

                    <div className="form-toggle-row mt-6">
                      <div>
                        <h4>Assisted Emergency Stop</h4>
                        <p>AI scans anomaly indicators and closes positions on risk spikes.</p>
                      </div>
                      <label className="toggle-switch">
                        <input type="checkbox" defaultChecked />
                        <span className="toggle-slider" />
                      </label>
                    </div>

                    <button onClick={() => triggerToast("Risk parameters successfully saved on-chain.")} className="save-risk-btn mt-6">
                      Save Risk Parameters
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. AGENT VIEW */}
          {activeTab === "Agent" && (
            <div className="agent-view-grid">
              <div className="agent-columns">
                {/* Active Agents list */}
                <div className="agents-list-panel">
                  <div className="panel-card-head">
                    <h3 className="panel-title">Active Toru Agents</h3>
                    <span className="panel-subtitle">Running automated execution processes</span>
                  </div>
                  <div className="agents-list">
                    {agents.map((ag) => (
                      <div className="agent-item-card" key={ag.id}>
                        <div className="agent-item-header">
                          <div>
                            <h4>{ag.name}</h4>
                            <p className="font-mono text-sm text-gray-500">Target leader: {ag.leader}</p>
                          </div>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={ag.status}
                              onChange={() => handleToggleAgent(ag.id, ag.name)}
                            />
                            <span className="toggle-slider" />
                          </label>
                        </div>
                        <div className="agent-item-footer">
                          <span className="agent-mode-badge">{ag.mode}</span>
                          <span className="agent-item-wallet">Funded: {ag.wallet} tUSD</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Create Agent Wizard */}
                <div className="create-agent-wizard">
                  <div className="panel-card-head">
                    <h3 className="panel-title">Create Agent</h3>
                    <span className="panel-subtitle">Deploy a new autonomous executor vault</span>
                  </div>
                  <div className="wizard-progress-bar">
                    {[1, 2, 3, 4, 5].map((step) => (
                      <div
                        className={`progress-step${step <= wizardStep ? " completed" : ""}`}
                        key={step}
                      >
                        {step}
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleCreateAgent} className="wizard-form">
                    {wizardStep === 1 && (
                      <div className="wizard-step-content">
                        <h3>Step 1: Pick Leader Wallet</h3>
                        <p className="text-sm text-gray-400 mb-4">Specify the address of the trader you want this agent to copy.</p>
                        <div className="form-group">
                          <label className="form-label">Leader Wallet Address / ENS</label>
                          <input
                            type="text"
                            placeholder="0x..."
                            value={newAgentLeader}
                            onChange={(e) => setNewAgentLeader(e.target.value)}
                            className="form-input"
                          />
                        </div>
                        <div className="form-group mt-4">
                          <label className="form-label">Agent Alias / Name</label>
                          <input
                            type="text"
                            placeholder="e.g. Vega Copier"
                            value={newAgentName}
                            onChange={(e) => setNewAgentName(e.target.value)}
                            className="form-input"
                          />
                        </div>
                        <button type="button" onClick={() => setWizardStep(2)} className="wizard-next-btn mt-6">
                          Next Step
                        </button>
                      </div>
                    )}

                    {wizardStep === 2 && (
                      <div className="wizard-step-content">
                        <h3>Step 2: Select Trading Mode</h3>
                        <p className="text-sm text-gray-400 mb-4">Choose how much autonomy you want to delegate to this agent.</p>
                        <div className="modes-selector">
                          {[
                            { name: "Autonomous Trading", desc: "Agent copies swaps instantly. Highly automated." },
                            { name: "Assisted Trading", desc: "Agent alerts you for approval before mirroring trades." },
                            { name: "Manual Trading", desc: "Agent outputs recommendations only; you execute." },
                          ].map((mode) => (
                            <div
                              onClick={() => setNewAgentMode(mode.name)}
                              className={`mode-option-box${newAgentMode === mode.name ? " selected" : ""}`}
                              key={mode.name}
                            >
                              <h4>{mode.name}</h4>
                              <p className="text-sm text-gray-400">{mode.desc}</p>
                            </div>
                          ))}
                        </div>
                        <div className="wizard-nav-btns mt-6">
                          <button type="button" onClick={() => setWizardStep(1)} className="wizard-back-btn">Back</button>
                          <button type="button" onClick={() => setWizardStep(3)} className="wizard-next-btn">Next</button>
                        </div>
                      </div>
                    )}

                    {wizardStep === 3 && (
                      <div className="wizard-step-content">
                        <h3>Step 3: Configure Guardrails</h3>
                        <p className="text-sm text-gray-400 mb-4">Define exact safety boundaries for execution.</p>
                        <div className="form-group">
                          <label className="form-label">Max Trade Size: <strong>${newAgentMaxTrade} tUSD</strong></label>
                          <input
                            type="range"
                            min="50"
                            max="1000"
                            value={newAgentMaxTrade}
                            onChange={(e) => setNewAgentMaxTrade(Number(e.target.value))}
                            className="form-range"
                          />
                        </div>
                        <div className="form-group mt-4">
                          <label className="form-label">Stop-Loss Threshold: <strong>-{newAgentStopLoss}%</strong></label>
                          <input
                            type="range"
                            min="5"
                            max="25"
                            value={newAgentStopLoss}
                            onChange={(e) => setNewAgentStopLoss(Number(e.target.value))}
                            className="form-range"
                          />
                        </div>
                        <div className="wizard-nav-btns mt-6">
                          <button type="button" onClick={() => setWizardStep(2)} className="wizard-back-btn">Back</button>
                          <button type="button" onClick={() => setWizardStep(4)} className="wizard-next-btn">Next</button>
                        </div>
                      </div>
                    )}

                    {wizardStep === 4 && (
                      <div className="wizard-step-content">
                        <h3>Step 4: Fund Agent Wallet</h3>
                        <p className="text-sm text-gray-400 mb-4">Deposit stablecoin reserve into the agent's vault contract.</p>
                        <div className="form-group">
                          <label className="form-label">Reserve Deposit Amount (tUSD)</label>
                          <input
                            type="number"
                            value={newAgentFunding}
                            onChange={(e) => setNewAgentFunding(e.target.value)}
                            className="form-input font-mono"
                          />
                        </div>
                        <div className="wizard-nav-btns mt-6">
                          <button type="button" onClick={() => setWizardStep(3)} className="wizard-back-btn">Back</button>
                          <button type="button" onClick={() => setWizardStep(5)} className="wizard-next-btn">Next</button>
                        </div>
                      </div>
                    )}

                    {wizardStep === 5 && (
                      <div className="wizard-step-content">
                        <h3>Step 5: Activate Agent</h3>
                        <p className="text-sm text-gray-400 mb-4">Deploy vault contract, fund wallet, and spin up AI executor loop.</p>
                        <div className="wizard-summary-box">
                          <div className="summary-row"><span>Leader:</span> <span className="font-mono text-xs">{newAgentLeader}</span></div>
                          <div className="summary-row"><span>Name:</span> <span>{newAgentName}</span></div>
                          <div className="summary-row"><span>Mode:</span> <span>{newAgentMode}</span></div>
                          <div className="summary-row"><span>Fund Size:</span> <span>${newAgentFunding} tUSD</span></div>
                          <div className="summary-row"><span>Guardrails:</span> <span>Max size ${newAgentMaxTrade} / Stop-loss -{newAgentStopLoss}%</span></div>
                        </div>
                        <div className="wizard-nav-btns mt-6">
                          <button type="button" onClick={() => setWizardStep(4)} className="wizard-back-btn">Back</button>
                          <button type="submit" className="wizard-submit-btn">Activate Agent</button>
                        </div>
                      </div>
                    )}
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* 5. COMMUNITY VIEW */}
          {activeTab === "Community" && (
            <div className="community-grid">
              <div className="community-layout">
                {/* Main Forums */}
                <div className="forums-panel">
                  <div className="panel-card-head">
                    <h3 className="panel-title">Research Threads & Market Discussions</h3>
                    <span className="panel-subtitle">Alpha sharing by Toru quants</span>
                  </div>

                  <div className="threads-list">
                    {[
                      { title: "Analyzing 0xVega's win-rate on Agni pools", author: "0xBacktester", replies: 24, activity: "2m ago", tag: "Research Threads" },
                      { title: "Stop-loss parameters optimization on high-slippage pairs", author: "QuantLord", replies: 15, activity: "15m ago", tag: "Signal Discussions" },
                      { title: "FusionX AMM liquidity mapping for optimal gas execution", author: "MantleWiz", replies: 8, activity: "1h ago", tag: "Market Discussions" },
                    ].map((thread, idx) => (
                      <div className="thread-item" key={idx}>
                        <span className="thread-tag">{thread.tag}</span>
                        <h4>{thread.title}</h4>
                        <div className="thread-meta">
                          <span>By {thread.author}</span>
                          <span>•</span>
                          <span>{thread.replies} comments</span>
                          <span>•</span>
                          <span>Active {thread.activity}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Live chat */}
                <div className="chat-panel">
                  <div className="panel-card-head">
                    <h3 className="panel-title">Community Feed</h3>
                    <span className="panel-subtitle">Live chat & execution broadcasts</span>
                  </div>
                  <div className="chat-stream">
                    {chatMessages.map((msg, i) => (
                      <div className="chat-bubble" key={i}>
                        <div className="bubble-header">
                          <span className="bubble-user">{msg.user}</span>
                          <span className="bubble-time">{msg.time}</span>
                        </div>
                        <p className="bubble-text">{msg.text}</p>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={sendChatMessage} className="chat-input-form">
                    <input
                      type="text"
                      placeholder="Discuss market activity..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      className="chat-input"
                    />
                    <button type="submit" className="chat-send-btn">Send</button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* 6. NEWS VIEW */}
          {activeTab === "News" && (
            <div className="news-grid">
              <div className="panel-card">
                <div className="panel-card-head">
                  <h3 className="panel-title">Intelligence Feed</h3>
                  <span className="panel-subtitle">Global crypto news & agent network releases</span>
                </div>
                <div className="news-list">
                  {[
                    { title: "Mantle Network liquidity passes $500M TVL milestones", time: "1h ago", source: "Toru News" },
                    { title: "FusionX V2 pool upgrades: Lower slippage bounds predicted for WETH/USDC", time: "3h ago", source: "CoinMarketCap API" },
                    { title: "Privy Auth integration releases secure MPC vault recovery workflows", time: "5h ago", source: "Security Desk" },
                    { title: "ERC-8004 identity registry standard sees heavy adoption among AI agents", time: "1d ago", source: "Etherscan" },
                  ].map((news, idx) => (
                    <div className="news-item-card" key={idx}>
                      <span className="news-source">{news.source} • {news.time}</span>
                      <h4>{news.title}</h4>
                      <p className="text-sm text-gray-400 mt-2">
                        Toru scanner indexes show increased transactional volume matching these announcements. Setting up targeted risk guardrails is recommended.
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 7. SETTINGS VIEW */}
          {activeTab === "Settings" && (
            <div className="settings-grid">
              <div className="panel-card">
                <div className="panel-card-head">
                  <h3 className="panel-title">Terminal Settings</h3>
                  <span className="panel-subtitle">API integrations & RPC nodes</span>
                </div>
                <div className="settings-form">
                  <div className="form-group">
                    <label className="form-label">Mantle Sepolia RPC Endpoint</label>
                    <input type="text" className="form-input font-mono" defaultValue="https://rpc.sepolia.mantle.xyz" />
                  </div>
                  <div className="form-group mt-4">
                    <label className="form-label">Privy Application ID</label>
                    <input type="text" className="form-input font-mono" defaultValue="cm2p9fa...8b10" />
                  </div>
                  <div className="form-group mt-4">
                    <label className="form-label">Upstash Redis REST Url</label>
                    <input type="text" className="form-input font-mono" defaultValue="https://toro-redis.upstash.io" />
                  </div>
                  <div className="form-group mt-4">
                    <label className="form-label">AI Strategist Model</label>
                    <select className="form-select">
                      <option>Claude 3.5 Haiku (Balanced Speed/Conviction)</option>
                      <option>Claude 3.5 Sonnet (Deep Quant Reasoning)</option>
                      <option>Toru Scorer Fallback (Deterministic Logic)</option>
                    </select>
                  </div>
                  <button onClick={() => triggerToast("Terminal configurations updated.")} className="save-settings-btn mt-6">
                    Save Configuration
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
