import React, { useState, useEffect, useRef } from 'react';

const API_BASE = "http://127.0.0.1:8000/api";

export default function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Data State
  const [stats, setStats] = useState({
    total_documents: 0,
    total_alerts: 0,
    total_escalated: 0,
    compliance_rate: 100,
    tickets_status: { Open: 0, Submitted: 0, Approved: 0, Rejected: 0 },
    tickets_department: { IT: 0, HR: 0, Legal: 0, Treasury: 0 }
  });
  const [alerts, setAlerts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [settings, setSettings] = useState({
    threshold: 0.50,
    gemini_api_key: "",
    skills_IT: "",
    skills_HR: "",
    skills_Legal: "",
    skills_Treasury: ""
  });
  
  // Loading & Action State
  const [loading, setLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [ingestText, setIngestText] = useState("");
  const [ingestDocName, setIngestDocName] = useState("Manual Ingest Document");
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [auditResult, setAuditResult] = useState(null);
  const [isScanning, setIsScanning] = useState(false);

  // Refs
  const fileInputRef = useRef(null);
  const evidenceFileInputRef = useRef(null);

  // Fetch data on load and when activeTab changes
  useEffect(() => {
    fetchStats();
    fetchAlerts();
    fetchTickets();
    fetchSettings();
  }, [activeTab]);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/dashboard`);
      if (res.ok) setStats(await res.json());
    } catch (err) {
      console.error("Error fetching stats:", err);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE}/alerts`);
      if (res.ok) setAlerts(await res.json());
    } catch (err) {
      console.error("Error fetching alerts:", err);
    }
  };

  const fetchTickets = async () => {
    try {
      const res = await fetch(`${API_BASE}/tickets`);
      if (res.ok) setTickets(await res.json());
    } catch (err) {
      console.error("Error fetching tickets:", err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings({
          threshold: parseFloat(data.threshold) || 0.50,
          gemini_api_key: data.gemini_api_key || "",
          skills_IT: data.skills_IT || "",
          skills_HR: data.skills_HR || "",
          skills_Legal: data.skills_Legal || "",
          skills_Treasury: data.skills_Treasury || ""
        });
      }
    } catch (err) {
      console.error("Error fetching settings:", err);
    }
  };

  // Upload handler
  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setIsScanning(true);
    setUploadStatus(null);
    
    const formData = new FormData();
    formData.append("file", file);
    formData.append("threshold", settings.threshold);

    try {
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        setUploadStatus({
          success: true,
          message: `Successfully processed ${file.name}. Scanned ${data.total_segments} pages, escalated ${data.escalated_count} anomalies.`
        });
        fetchStats();
        fetchAlerts();
        fetchTickets();
      } else {
        const data = await res.json();
        setUploadStatus({
          success: false,
          message: `Error: ${data.detail || "Scanning failed."}`
        });
      }
    } catch (err) {
      setUploadStatus({ success: false, message: "Network error during upload." });
    } finally {
      setLoading(false);
      setIsScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Manual Ingest handler
  const handleManualIngest = async (e) => {
    e.preventDefault();
    if (!ingestText.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ingest-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_name: ingestDocName,
          text_content: ingestText
        })
      });
      if (res.ok) {
        const data = await res.json();
        setUploadStatus({
          success: true,
          message: `Text scanned. Anomaly Rscore: ${data.rscore.toFixed(4)}. Escalated: ${data.is_escalated ? "YES" : "NO"}.`
        });
        setIngestText("");
        fetchStats();
        fetchAlerts();
        fetchTickets();
      }
    } catch (err) {
      console.error("Manual ingest failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // Submit Evidence handler
  const handleSubmitEvidence = async (e) => {
    e.preventDefault();
    if (!selectedTicket) return;

    setLoading(true);
    setAuditResult(null);

    const formData = new FormData();
    if (evidenceFile) {
      formData.append("file", evidenceFile);
    } else if (evidenceText.trim()) {
      formData.append("evidence_text", evidenceText);
    } else {
      alert("Please enter text evidence or upload an evidence document.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/tickets/${selectedTicket.id}/submit-evidence`, {
        method: "POST",
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        setAuditResult({
          passed: data.audit_passed,
          score: data.audit_score,
          feedback: data.feedback
        });
        
        // Refresh local details
        setSelectedTicket(prev => ({
          ...prev,
          status: data.ticket_status,
          audit_score: data.audit_score,
          audit_feedback: data.feedback,
          evidence_file: evidenceFile ? evidenceFile.name : "Manual Text Entry",
          evidence_text: evidenceText || "Document parsed"
        }));

        fetchStats();
        fetchTickets();
      } else {
        alert("Evidence submission failed.");
      }
    } catch (err) {
      console.error("Submit evidence error:", err);
    } finally {
      setLoading(false);
      setEvidenceText("");
      setEvidenceFile(null);
      if (evidenceFileInputRef.current) evidenceFileInputRef.current.value = "";
    }
  };

  // Run audit loop manually
  const triggerAuditLoop = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/audit-loop`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        alert(`Audit loop completed. Re-audited ${data.audited_tickets_count} tickets.`);
        fetchStats();
        fetchTickets();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Save Settings handler
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        alert("Settings saved successfully.");
        fetchSettings();
      } else {
        alert("Failed to save settings.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSettingsChange = (key, val) => {
    setSettings(prev => ({ ...prev, [key]: val }));
  };

  // Calculation for Donut Chart
  const approvedCount = stats.tickets_status.Approved || 0;
  const submittedCount = stats.tickets_status.Submitted || 0;
  const rejectedCount = stats.tickets_status.Rejected || 0;
  const openCount = stats.tickets_status.Open || 0;
  const totalDonutTickets = approvedCount + submittedCount + rejectedCount + openCount;

  const getDonutSegments = () => {
    if (totalDonutTickets === 0) {
      return [{ strokeDashArray: "100 100", strokeDashOffset: "0", color: "var(--primary-blue)", label: "No Active Tasks" }];
    }
    const segments = [
      { count: approvedCount, color: "var(--color-success)", label: "Verified" },
      { count: submittedCount, color: "var(--secondary-yellow)", label: "Auditing" },
      { count: rejectedCount, color: "var(--color-error)", label: "Audit Fail" },
      { count: openCount, color: "var(--primary-blue)", label: "Open" }
    ];
    let accumulatedPercentage = 0;
    return segments.map(seg => {
      const percentage = (seg.count / totalDonutTickets) * 100;
      const strokeDashArray = `${percentage} ${100 - percentage}`;
      const strokeDashOffset = `-${accumulatedPercentage}`;
      accumulatedPercentage += percentage;
      return { ...seg, strokeDashArray, strokeDashOffset };
    });
  };

  // SVGs Icons System matching prompt instructions
  const Icons = {
    Hamburger: () => (
      <svg style={{ width: '18px', height: '18px' }} fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
    ),
    Cross: () => (
      <svg style={{ width: '18px', height: '18px' }} fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
    ),
    Dashboard: () => (
      <svg style={{ width: '16px', height: '16px' }} fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" /></svg>
    ),
    Scanner: () => (
      <svg style={{ width: '16px', height: '16px' }} fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0a8 8 0 11-16 0 8 8 0 0116 0z" /></svg>
    ),
    Orchestrator: () => (
      <svg style={{ width: '16px', height: '16px' }} fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
    ),
    Tasks: () => (
      <svg style={{ width: '16px', height: '16px' }} fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
    ),
    Settings: () => (
      <svg style={{ width: '16px', height: '16px' }} fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
    ),
    Upload: () => (
      <svg style={{ width: '22px', height: '22px' }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
    )
  };

  // Calculated active alert counts for neon badges
  const dynamicActiveAlertsCount = alerts.filter(a => a.is_escalated && tickets.find(t => t.alert_id === a.id && t.status !== 'Approved')).length;

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
        <div className="brand">
          <div className="brand-icon">S</div>
          <div style={{ flex: 1 }}>
            <h1 className="brand-title">Sentinel-RegAI</h1>
            <p className="brand-subtitle">Compliance Engine</p>
          </div>
          <button 
            className="close-sidebar-btn" 
            onClick={() => setIsSidebarOpen(false)}
            title="Close Sidebar"
          >
            <Icons.Cross />
          </button>
        </div>

        <nav className="nav-links">
          <button 
            onClick={() => setActiveTab('dashboard')} 
            className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
          >
            <Icons.Dashboard /> Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('alpha')} 
            className={`nav-link ${activeTab === 'alpha' ? 'active' : ''}`}
          >
            <Icons.Scanner /> Ingestion Scanner
          </button>
          <button 
            onClick={() => setActiveTab('beta')} 
            className={`nav-link ${activeTab === 'beta' ? 'active' : ''}`}
          >
            <Icons.Orchestrator /> Orchestrator Loop
            {dynamicActiveAlertsCount > 0 && (
              <span className="nav-link-badge">{dynamicActiveAlertsCount}</span>
            )}
          </button>
          <button 
            onClick={() => setActiveTab('tasks')} 
            className={`nav-link ${activeTab === 'tasks' ? 'active' : ''}`}
          >
            <Icons.Tasks /> Task Command
          </button>
          <button 
            onClick={() => setActiveTab('settings')} 
            className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}
          >
            <Icons.Settings /> Configuration
          </button>
        </nav>

        {/* System Health / API Indicator */}
        <div className="system-status">
          <div className="status-indicator">
            <div>
              <span className="text-label">Gemini Core</span>
              <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-primary)' }}>
                {settings.gemini_api_key ? "Connected AI" : "Offline Local"}
              </span>
            </div>
            <div className={`status-dot ${settings.gemini_api_key ? 'active' : 'inactive'}`} />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        
        {/* Top Header */}
        <header className={`app-header ${!isSidebarOpen ? 'header-closed' : ''}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {!isSidebarOpen && (
              <button 
                className="header-hamburger-btn" 
                onClick={() => setIsSidebarOpen(true)}
                title="Open Sidebar"
              >
                <Icons.Hamburger />
              </button>
            )}
            <div className="header-title">
              <h2>
                {activeTab === 'dashboard' && "Compliance Command Center"}
                {activeTab === 'alpha' && "Agent Alpha: Intelligence Ingestion"}
                {activeTab === 'beta' && "Agent Beta: Cognitive Orchestrator"}
                {activeTab === 'tasks' && "Operational Audit Command"}
                {activeTab === 'settings' && "Engine Configuration"}
              </h2>
              <p>
                {activeTab === 'dashboard' && "Overview of real-time regulatory parsing and cognitive compliance audits."}
                {activeTab === 'alpha' && "Neural segment mapping, anomaly checks, and BERT regulatory text classification."}
                {activeTab === 'beta' && "Generative MAP creation, autonomous policy interpretation, and structural reasoning logs."}
                {activeTab === 'tasks' && "Submit operational evidence logs to satisfy autonomous regulatory action points."}
                {activeTab === 'settings' && "Adjust detection trigger parameters and customize department skill vectors."}
              </p>
            </div>
          </div>
          <div className="header-actions">
            <button 
              onClick={triggerAuditLoop}
              className="btn-secondary"
              disabled={loading}
            >
              Run Audit Recheck
            </button>
            <div className="version-tag">
              v1.0.0
            </div>
          </div>
        </header>

        {/* Tab Views */}
        <div className="views-container">
          
          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              {/* KPI Metrics Grid */}
              <div className="metrics-grid">
                <div className="glass-card metric-card glow-blue">
                  <span className="metric-label">Compliance Rate</span>
                  <span className="metric-value" style={{ color: 'var(--color-success)' }}>{stats.compliance_rate}%</span>
                  <div className="progress-bar-container">
                    <div className="progress-bar-fill" style={{ width: `${stats.compliance_rate}%`, backgroundColor: 'var(--color-success)' }} />
                  </div>
                </div>

                <div className="glass-card metric-card glow-blue">
                  <span className="metric-label">Documents Ingested</span>
                  <span className="metric-value" style={{ color: 'var(--primary-blue)' }}>{stats.total_documents}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '12px' }}>Source bank policy files</span>
                </div>

                <div className="glass-card metric-card glow-blue">
                  <span className="metric-label">Calculated Risk Score</span>
                  <span className="metric-value" style={{ color: rejectedCount > 0 ? 'var(--color-error)' : 'var(--secondary-yellow)' }}>
                    {totalDonutTickets > 0 ? ((rejectedCount / totalDonutTickets) * 100).toFixed(0) : 0}%
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '12px' }}>Based on audit failures</span>
                </div>

                <div className="glass-card metric-card glow-blue">
                  <span className="metric-label">Active Alerts</span>
                  <span className="metric-value" style={{ color: openCount > 0 ? 'var(--color-error)' : 'var(--text-secondary)' }}>{stats.total_escalated}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '12px' }}>Exceeding classification trigger</span>
                </div>
              </div>

              {/* Charts Display Grid */}
              <div className="dashboard-grid">
                
                {/* Left Side: Line Chart & Allocation */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  
                  {/* Native SVG Compliance Trend Line Chart */}
                  <div className="glass-card">
                    <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '16px', fontSize: '15px', fontWeight: '700' }}>Compliance Trend Line (Recent Cycles)</h3>
                    <div style={{ width: '100%', height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="100%" height="100%" viewBox="0 0 500 150" preserveAspectRatio="none">
                        {/* Grid Lines */}
                        <line x1="0" y1="30" x2="500" y2="30" className="chart-grid-line" />
                        <line x1="0" y1="75" x2="500" y2="75" className="chart-grid-line" />
                        <line x1="0" y1="120" x2="500" y2="120" className="chart-grid-line" />
                        
                        {/* Area Gradient */}
                        <defs>
                          <linearGradient id="chart-glow" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--primary-blue)" stopOpacity="0.15" />
                            <stop offset="100%" stopColor="var(--primary-blue)" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>
                        <path d={`M 20 120 L 100 ${140 - (stats.compliance_rate * 1.1)} L 200 ${130 - (stats.compliance_rate * 1.1)} L 300 40 L 400 45 L 480 ${150 - (stats.compliance_rate * 1.3)} L 480 135 L 20 135 Z`} fill="url(#chart-glow)" />
                        
                        {/* Trend Line Path */}
                        <path 
                          d={`M 20 120 L 100 ${140 - (stats.compliance_rate * 1.1)} L 200 ${130 - (stats.compliance_rate * 1.1)} L 300 40 L 400 45 L 480 ${150 - (stats.compliance_rate * 1.3)}`} 
                          fill="none" 
                          stroke="var(--primary-blue)" 
                          strokeWidth="2.5" 
                          className="chart-svg-line" 
                        />

                        {/* Chart Nodes */}
                        <circle cx="20" cy="120" r="4" fill="var(--bg-primary)" stroke="var(--primary-blue)" strokeWidth="2" />
                        <circle cx="300" cy="40" r="4" fill="var(--bg-primary)" stroke="var(--primary-blue)" strokeWidth="2" />
                        <circle cx="480" cy={150 - (stats.compliance_rate * 1.3)} r="4" fill="var(--color-success)" stroke="var(--bg-primary)" strokeWidth="1.5" />
                        
                        {/* Labels */}
                        <text x="25" y="25" className="chart-axis-text">100% Target State</text>
                        <text x="20" y="145" className="chart-axis-text">Cycle 01</text>
                        <text x="240" y="145" className="chart-axis-text">Cycle 03</text>
                        <text x="440" y="145" className="chart-axis-text">Current State</text>
                      </svg>
                    </div>
                  </div>

                  {/* Department Compliance Bar Chart */}
                  <div className="glass-card">
                    <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '20px', fontSize: '15px', fontWeight: '700' }}>Department Compliance Bar Chart</h3>
                    <div className="allocation-list">
                      {['IT', 'HR', 'Legal', 'Treasury'].map(dept => {
                        const count = stats.tickets_department[dept] || 0;
                        const max = Math.max(...Object.values(stats.tickets_department), 1);
                        const percent = (count / max) * 100;
                        return (
                          <div key={dept} className="allocation-item">
                            <div className="allocation-header">
                              <span>{dept} Profile Framework</span>
                              <span style={{ color: 'var(--primary-blue)', fontWeight: '600' }}>{count} Action Tickets</span>
                            </div>
                            <div style={{ width: '100%', backgroundColor: 'rgba(15,23,42,0.03)', border: '1px solid var(--glass-border)', height: '7px', borderRadius: '4px', overflow: 'hidden' }}>
                              <div 
                                style={{ height: '100%', borderRadius: '4px', background: 'linear-gradient(90deg, var(--primary-blue), var(--blue-hover))', width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>

                {/* Right Side: Donut Chart & Activity Timeline */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  
                  {/* Risk Distribution Donut Chart */}
                  <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', width: '100%', textAlign: 'left', marginBottom: '16px', fontSize: '15px', fontWeight: '700' }}>Risk Distribution Donut Chart</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', gap: '16px', width: '100%', flexWrap: 'wrap' }}>
                      {/* Donut Legend (Vertical Format, Left Side) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0, padding: '8px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-success)' }} />
                          <span style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>Verified: {approvedCount}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--secondary-yellow)' }} />
                          <span style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>Auditing: {submittedCount}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-error)' }} />
                          <span style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>Fail: {rejectedCount}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--primary-blue)' }} />
                          <span style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>Open: {openCount}</span>
                        </div>
                      </div>

                      {/* Donut Chart (Right Side, Increased Size) */}
                      <div style={{ position: 'relative', width: '180px', height: '180px', flexShrink: 0 }}>
                        <svg width="100%" height="100%" viewBox="0 0 42 42">
                          <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="rgba(15,23,42,0.03)" strokeWidth="4" />
                          {getDonutSegments().map((seg, idx) => (
                            <circle 
                              key={idx}
                              cx="21" 
                              cy="21" 
                              r="15.915" 
                              fill="transparent" 
                              stroke={seg.color} 
                              strokeWidth="4" 
                              strokeDasharray={seg.strokeDashArray} 
                              strokeDashoffset={seg.strokeDashOffset} 
                              className="chart-donut-segment"
                            />
                          ))}
                        </svg>
                        <div style={{ position: 'absolute', top: '0', left: '0', right: '0', bottom: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: '26px', fontWeight: '800', fontFamily: 'var(--font-display)', lineHeight: '1' }}>{totalDonutTickets}</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '2px' }}>Tasks</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Audit Activity Timeline */}
                  <div className="glass-card">
                    <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '10px', fontSize: '15px', fontWeight: '700' }}>Audit Activity Timeline</h3>
                    <div className="timeline-container">
                      {tickets.slice(0, 3).map((t, index) => {
                        let dotColor = "blue";
                        if (t.status === 'Approved') dotColor = "green";
                        if (t.status === 'Rejected') dotColor = "red";
                        if (t.status === 'Submitted') dotColor = "yellow";
                        return (
                          <div key={t.id} className="timeline-item">
                            <div className={`timeline-dot ${dotColor}`} />
                            <span className="timeline-time">Ticket ID #{t.id} • {t.department}</span>
                            <p className="timeline-content">Autonomous action point titled <strong>{t.title}</strong> shifted status state to <strong>{t.status}</strong>.</p>
                          </div>
                        );
                      })}
                      {tickets.length === 0 && (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '10px 0' }}>Timeline waiting for scanned data logs.</div>
                      )}
                    </div>
                  </div>

                </div>

              </div>

              {/* Recent Alerts Feed Table */}
              <div className="glass-card">
                <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '16px', fontSize: '15px', fontWeight: '700' }}>Recent Regulatory Compliance Intelligence Feeds</h3>
                <div className="table-container">
                  <table className="table-el">
                    <thead>
                      <tr>
                        <th>Source File</th>
                        <th>Extracted Alert Fragment</th>
                        <th>BERT Anomaly Score</th>
                        <th>Escalation State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.slice(0, 5).map(alert => (
                        <tr key={alert.id}>
                          <td style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{alert.document_name}</td>
                          <td style={{ maxWidth: '420px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{alert.content}</td>
                          <td style={{ fontFamily: 'monospace', color: 'var(--primary-blue)', strokeWidth: '1.5', fontWeight: '700' }}>{(alert.rscore * 100).toFixed(1)}%</td>
                          <td>
                            <span className={`badge ${alert.is_escalated ? 'badge-escalated' : 'badge-bau'}`}>
                              {alert.is_escalated ? 'Escalated' : 'BAU'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {alerts.length === 0 && (
                        <tr>
                          <td colSpan="4" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            No intelligence updates available. Ingest a document framework to initialize the feed.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: INGESTION SCANNER */}
          {activeTab === 'alpha' && (
            <div className="scanner-layout">
              {/* Ingestion Side Controls */}
              <div className="scanner-controls">
                <div className="glass-card">
                  <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '12px', fontSize: '15px', fontWeight: '700' }}>Neural Ingestion Engine</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.5' }}>Upload enterprise regulatory mandates or PDF files to run parsing pipelines.</p>
                  
                  <div 
                    onClick={() => fileInputRef.current.click()}
                    className="drop-zone"
                    style={isScanning ? { borderColor: 'var(--primary-blue)', backgroundColor: 'rgba(1, 158, 236, 0.05)' } : {}}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleUpload} 
                      className="hidden" 
                      style={{ display: 'none' }}
                      accept=".pdf"
                      disabled={loading}
                    />
                    <div style={{ color: 'var(--primary-blue)', marginBottom: '12px' }}><Icons.Upload /></div>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>{isScanning ? "Processing Framework..." : "Upload BankSavers PDF"}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '5px' }}>Supported format: Adobe PDF</span>
                  </div>

                  {uploadStatus && (
                    <div style={{ 
                      marginTop: '16px', 
                      padding: '12px', 
                      borderRadius: '10px', 
                      fontSize: '12px', 
                      lineHeight: '1.4',
                      border: '1px solid',
                      backgroundColor: uploadStatus.success ? 'rgba(34, 197, 94, 0.04)' : 'rgba(255, 77, 109, 0.04)',
                      borderColor: uploadStatus.success ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 77, 109, 0.15)',
                      color: uploadStatus.success ? 'var(--color-success)' : 'var(--color-error)'
                    }}>
                      {uploadStatus.message}
                    </div>
                  )}
                </div>

                <div className="glass-card">
                  <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '16px', fontSize: '15px', fontWeight: '700' }}>Manual Policy Ingest</h3>
                  <form onSubmit={handleManualIngest} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="form-group">
                      <label>Framework Identifier Label</label>
                      <input 
                        type="text" 
                        value={ingestDocName}
                        onChange={(e) => setIngestDocName(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div className="form-group">
                      <label>Regulatory Alert Body Text</label>
                      <textarea 
                        value={ingestText}
                        onChange={(e) => setIngestText(e.target.value)}
                        placeholder="Paste single policy mandate, compliance circular details or updates..."
                        rows="4"
                        className="form-input"
                        style={{ resize: 'none' }}
                        required
                      />
                    </div>
                    <button 
                      type="submit" 
                      className="btn-primary" 
                      style={{ width: '100%', justifyContent: 'center' }}
                      disabled={loading}
                    >
                      Execute Neural Scanner
                    </button>
                  </form>
                </div>
              </div>

              {/* Feed logs outputs */}
              <div className="glass-card scanner-feed">
                <div className="feed-header">
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: '700' }}>Alpha Classifier Real-Time Log</h3>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Trigger Threshold: $\theta$ = {settings.threshold.toFixed(2)}</span>
                </div>
                <div className="feed-items">
                  {alerts.map(alert => {
                    const isEsc = alert.is_escalated;
                    return (
                      <div 
                        key={alert.id} 
                        className="feed-item"
                        style={isEsc ? { borderLeft: '3px solid var(--color-error)', backgroundColor: 'rgba(255, 77, 109, 0.01)' } : {}}
                      >
                        <div className="feed-item-header">
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            Source: {alert.document_name}
                          </span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <span className="badge badge-rscore">
                              Rscore: {alert.rscore.toFixed(4)}
                            </span>
                            <span className={`badge ${isEsc ? 'badge-escalated' : 'badge-bau'}`}>
                              {isEsc ? 'Escalated' : 'BAU'}
                            </span>
                          </div>
                        </div>
                        <p style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>{alert.content}</p>
                      </div>
                    );
                  })}
                  {alerts.length === 0 && (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '10px' }}>
                      <svg style={{ width: '28px', height: '28px', color: 'var(--text-muted)' }} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      <p style={{ fontSize: '13px' }}>Scanned database records are currently uninitialized.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AGENT BETA ORCHESTRATOR */}
          {activeTab === 'beta' && (
            <div className="orchestrator-layout">
              {/* Escalation Queue side panel */}
              <div className="glass-card queue-panel">
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: '700', marginBottom: '4px' }}>Cognitive Escalation Queue</h3>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '18px' }}>Scanned segments tagged for vector assignment.</p>
                <div className="queue-items">
                  {alerts.filter(a => a.is_escalated).map(alert => {
                    const ticket = tickets.find(t => t.alert_id === alert.id);
                    return (
                      <div 
                        key={alert.id}
                        onClick={() => {
                          if (ticket) setSelectedTicket(ticket);
                        }}
                        className={`queue-card ${selectedTicket?.alert_id === alert.id ? 'active' : ''}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{alert.document_name}</span>
                          <span className="badge badge-escalated" style={{ fontSize: '8px', padding: '1px 5px' }}>Rscore: {alert.rscore.toFixed(3)}</span>
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }} className="line-clamp-2">
                          {alert.content}
                        </p>
                        {ticket && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(15,23,42,0.03)', fontSize: '11px' }}>
                            <span style={{ color: '#8B5CF6', fontWeight: '600' }}>Routed: {ticket.department}</span>
                            <span style={{ color: 'var(--primary-blue)' }}>Inspect Reasoning &rarr;</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {alerts.filter(a => a.is_escalated).length === 0 && (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '10px' }}>
                      <p style={{ fontSize: '12px' }}>Cognitive escalation list is unpopulated.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* AI Reasoning Core Flow View */}
              <div className="glass-card reasoning-panel">
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: '700', marginBottom: '18px' }}>Agent Beta Router Cognitive Engine Execution</h3>
                
                {selectedTicket ? (
                  <div className="reasoning-steps">
                    {/* Step 1 */}
                    <div className="reasoning-step">
                      <div className="reasoning-step-header step-rose">
                        <span style={{ width: '6px', height: '6px', backgroundColor: 'var(--color-error)', borderSelf: '50%', borderRadius: '50%' }} />
                        Sub-pipeline 01: Scanned Anomaly Payload Context
                      </div>
                      <p className="reasoning-text" style={{ fontStyle: 'italic', backgroundColor: 'rgba(15,23,42,0.03)', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-light)' }}>
                        "{alerts.find(a => a.id === selectedTicket.alert_id)?.content}"
                      </p>
                    </div>

                    {/* Step 2 */}
                    <div className="reasoning-step">
                      <div className="reasoning-step-header step-cyan">
                        <span style={{ width: '6px', height: '6px', backgroundColor: 'var(--primary-blue)', borderRadius: '50%' }} />
                        Sub-pipeline 02: Generative Action Item Refinement (MAP)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                          <span className="text-label">Actionable Task Framework Title</span>
                          <h4 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>{selectedTicket.title}</h4>
                        </div>
                        <div>
                          <span className="text-label">Operational Measurement Action Point Specification (MAP)</span>
                          <p className="reasoning-text reasoning-code">
                            {selectedTicket.description}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="reasoning-step">
                      <div className="reasoning-step-header step-violet">
                        <span style={{ width: '6px', height: '6px', backgroundColor: '#8B5CF6', borderRadius: '50%' }} />
                        Sub-pipeline 03: TF-IDF Cosine Skills Profiling Association Match
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div>
                          <span className="text-label">Matched Organizational Framework</span>
                          <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: '5px', backgroundColor: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)', fontSize: '11px', color: '#8B5CF6', fontWeight: '700', marginTop: '4px' }}>
                            {selectedTicket.department} Department
                          </span>
                        </div>
                        <div>
                          <span className="text-label">Calculated Similarity Target Match</span>
                          <div style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: '700', color: '#8B5CF6', marginTop: '4px' }}>
                            {selectedTicket.similarity_score.toFixed(4)}
                          </div>
                        </div>
                      </div>
                      <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5', borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}>
                        Task vector projections are calculated against matrix models. The optimal matching score initiates an immediate autonomous assignment mapping to the {selectedTicket.department} control team.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '10px' }}>
                    <p style={{ fontSize: '13px' }}>Select an active record within the escalation feed queue to map neural reasoning flow states.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: TASK BOARD */}
          {activeTab === 'tasks' && (
            <div className="kanban-board">
              
              {/* The Four Departmental Swimlanes */}
              {['IT', 'HR', 'Legal', 'Treasury'].map(dept => {
                const deptTickets = tickets.filter(t => t.department === dept);
                return (
                  <div key={dept} className="kanban-column">
                    <div className="column-header">
                      <span className="column-title">{dept} Framework Swimlane</span>
                      <span className="column-count">{deptTickets.length}</span>
                    </div>

                    <div className="kanban-cards">
                      {deptTickets.map(ticket => (
                        <div 
                          key={ticket.id}
                          onClick={() => {
                            setSelectedTicket(ticket);
                            setAuditResult(null);
                          }}
                          className={`kanban-card ${selectedTicket?.id === ticket.id ? 'active' : ''}`}
                        >
                          <h4 className="kanban-card-title">{ticket.title}</h4>
                          <p className="kanban-card-body line-clamp-2">{ticket.description}</p>
                          
                          <div className="kanban-card-footer">
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>ID: #{ticket.id}</span>
                            <span className={`badge-status ${
                              ticket.status === 'Approved' ? 'badge-status-approved' :
                              ticket.status === 'Rejected' ? 'badge-status-rejected' :
                              ticket.status === 'Submitted' ? 'badge-status-submitted' :
                              'badge-status-open'
                            }`}>
                              {ticket.status === 'Approved' ? 'Verified' : 
                               ticket.status === 'Rejected' ? 'Audit Fail' : 
                               ticket.status === 'Submitted' ? 'Auditing' : 'Open'}
                            </span>
                          </div>
                        </div>
                      ))}
                      {deptTickets.length === 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontWeight: '600', fontSize: '11px', height: '100px' }}>
                          No operational tickets bound.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Task Sidebar drawer Modal */}
              {selectedTicket && (
                <div className="drawer">
                  <div className="drawer-header">
                    <div>
                      <span className="text-label" style={{ color: 'var(--primary-blue)' }}>{selectedTicket.department} Audit Command Sheet</span>
                      <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', marginTop: '3px' }}>{selectedTicket.title}</h3>
                    </div>
                    <button className="drawer-close" onClick={() => setSelectedTicket(null)}>✕ Close</button>
                  </div>

                  <div className="drawer-content">
                    <div className="form-group">
                      <span className="text-label">Target Mandatory Action Point Definition</span>
                      <p style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.6', padding: '12px', border: '1px solid var(--glass-border)', borderRadius: '10px', backgroundColor: 'rgba(15,23,42,0.01)' }}>
                        {selectedTicket.description}
                      </p>
                    </div>

                    {selectedTicket.evidence_file && (
                      <div className="audit-results-card passed" style={{ backgroundColor: 'rgba(34, 197, 94, 0.02)' }}>
                        <span className="text-label" style={{ color: 'var(--color-success)' }}>Ingested Log Verification Context</span>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', display: 'block', marginTop: '2px' }}>{selectedTicket.evidence_file}</span>
                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px', fontFamily: 'monospace', backgroundColor: 'rgba(0,0,0,0.15)', padding: '8px', borderRadius: '5px', overflowX: 'auto' }}>
                          {selectedTicket.evidence_text}
                        </p>
                      </div>
                    )}

                    {/* Score feedback logs inside container card */}
                    {(selectedTicket.audit_score !== null || auditResult) && (
                      <div className={`audit-results-card ${
                        (auditResult?.passed ?? selectedTicket.status === 'Approved') ? 'passed' : 'failed'
                      }`}>
                        <div className="audit-score-row">
                          <span>{(auditResult?.passed ?? selectedTicket.status === 'Approved') ? 'Audit Passed' : 'Audit Failed'}</span>
                          <span style={{ fontFamily: 'monospace' }}>
                            Score: {(((auditResult?.score ?? selectedTicket.audit_score) || 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                          {auditResult?.feedback ?? selectedTicket.audit_feedback}
                        </p>
                      </div>
                    )}

                    {/* Ingestion form submission controls */}
                    <form onSubmit={handleSubmitEvidence} style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid var(--glass-border)', paddingTop: '20px' }}>
                      <span className="text-label" style={{ fontSize: '11px' }}>Append Compliance Verification Evidence</span>
                      
                      <div className="form-group">
                        <label>Upload Document Logs (TXT / PDF)</label>
                        <input 
                          type="file" 
                          ref={evidenceFileInputRef} 
                          onChange={(e) => setEvidenceFile(e.target.files[0])}
                          className="form-input"
                          accept=".pdf,.txt"
                        />
                      </div>
                      
                      <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.05em' }}>— STRATEGIC PAYLOAD STRING OVERRIDE —</div>

                      <div className="form-group">
                        <label>Paste Text Ingestion Logs</label>
                        <textarea 
                          value={evidenceText}
                          onChange={(e) => setEvidenceText(e.target.value)}
                          placeholder="Paste command line terminal telemetry checks or proof documentation..."
                          rows="4"
                          className="form-input"
                          style={{ resize: 'none' }}
                        />
                      </div>

                      <button 
                        type="submit" 
                        className="btn-primary" 
                        style={{ justifyContent: 'center' }}
                        disabled={loading}
                      >
                        {loading ? "Calculating verification metrics..." : "Commit Evidence & Audit"}
                      </button>
                    </form>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* TAB 5: ENGINE CONFIGURATION */}
          {activeTab === 'settings' && (
            <div className="glass-card" style={{ maxWidth: '820px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '17px', fontWeight: '700', marginBottom: '24px' }}>System Engine Settings Profiles</h3>
              
              <form onSubmit={handleSaveSettings} className="settings-form">
                
                {/* Trigger levels */}
                <div className="slider-container">
                  <div className="slider-header">
                    <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Agent Alpha Classification Parameter Anomaly Level ($\theta$)</label>
                    <span style={{ fontFamily: 'monospace', color: 'var(--secondary-yellow)', fontWeight: '700', fontSize: '14px' }}>{settings.threshold.toFixed(2)}</span>
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px', lineHeight: '1.4' }}>
                    Trigger calibration level for extracting risk alerts from standard operating texts during text segment ingestion.
                  </p>
                  <input 
                    type="range" 
                    min="0.05" 
                    max="0.95" 
                    step="0.05"
                    value={settings.threshold} 
                    onChange={(e) => handleSettingsChange('threshold', parseFloat(e.target.value))}
                    className="slider-el"
                  />
                </div>

                {/* Secret Key configurations */}
                <div className="form-group">
                  <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Gemini Core Cognitive API Token String</label>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    Provide an authorized API key to initialize structural cognitive audit generation features. Local keyword vector algorithms are backed up automatically if unpopulated.
                  </p>
                  <input 
                    type="password" 
                    value={settings.gemini_api_key} 
                    onChange={(e) => handleSettingsChange('gemini_api_key', e.target.value)}
                    placeholder="Provide AIzaSy token parameter..."
                    className="form-input"
                    style={{ fontFamily: 'monospace' }}
                  />
                </div>

                {/* Matrix values configurations fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid var(--glass-border)', paddingTop: '20px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Vector Space Skill Alignment Profiles</h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    Adjust token keywords mapping individual corporate components. These definitions calibrate the routing engine calculations.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div className="form-group">
                      <label style={{ fontSize: '11px' }}>IT Infrastructure Control Tokens</label>
                      <textarea 
                        value={settings.skills_IT} 
                        onChange={(e) => handleSettingsChange('skills_IT', e.target.value)}
                        rows="3"
                        className="form-input"
                        style={{ resize: 'none' }}
                      />
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: '11px' }}>Human Capital Operational Profiles</label>
                      <textarea 
                        value={settings.skills_HR} 
                        onChange={(e) => handleSettingsChange('skills_HR', e.target.value)}
                        rows="3"
                        className="form-input"
                        style={{ resize: 'none' }}
                      />
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: '11px' }}>Legal Control & Auditing Standards</label>
                      <textarea 
                        value={settings.skills_Legal} 
                        onChange={(e) => handleSettingsChange('skills_Legal', e.target.value)}
                        rows="3"
                        className="form-input"
                        style={{ resize: 'none' }}
                      />
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: '11px' }}>Treasury Risk & Capital Reserves</label>
                      <textarea 
                        value={settings.skills_Treasury} 
                        onChange={(e) => handleSettingsChange('skills_Treasury', e.target.value)}
                        rows="3"
                        className="form-input"
                        style={{ resize: 'none' }}
                      />
                    </div>
                  </div>
                </div>

                <button 
                  type="submit" 
                  className="btn-primary" 
                  style={{ width: 'fit-content' }}
                  disabled={loading}
                >
                  Save Framework Settings
                </button>

              </form>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
