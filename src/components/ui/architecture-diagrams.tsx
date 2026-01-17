import React, { useState } from "react"
import { motion } from "framer-motion"

// Architecture Viewer with HLD/LLD tabs
interface ArchitectureViewerProps {
  hld: React.ReactNode
  lld: React.ReactNode | null
}

export function ArchitectureViewer({ hld, lld }: ArchitectureViewerProps) {
  const [activeTab, setActiveTab] = useState<'hld' | 'lld'>('hld')
  
  return (
    <div className="w-full h-full flex flex-col">
      {/* Tab Buttons */}
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setActiveTab('hld')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
            activeTab === 'hld' 
              ? 'bg-violet-500 text-white shadow-lg' 
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          High-Level Design
        </button>
        {lld && (
          <button
            onClick={() => setActiveTab('lld')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'lld' 
                ? 'bg-violet-500 text-white shadow-lg' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Low-Level Design
          </button>
        )}
      </div>
      
      {/* Content */}
      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-inner overflow-hidden min-h-[300px]">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: activeTab === 'hld' ? -10 : 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className="w-full h-full"
        >
          {activeTab === 'hld' ? hld : lld}
        </motion.div>
      </div>
    </div>
  )
}

// ===========================
// X-RADAR ARCHITECTURE
// ===========================
export function XRadarHLD() {
  return (
    <div className="w-full h-full flex flex-col gap-4 p-4 text-xs">
      {/* Title */}
      <div className="text-center">
        <h4 className="text-sm font-bold text-slate-800">High-Level Design</h4>
        <p className="text-[10px] text-slate-500">Unified Monitoring Platform</p>
      </div>
      
      {/* Architecture Layers */}
      <div className="flex-1 flex flex-col gap-2">
        {/* Presentation Layer */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-violet-500 to-purple-500 rounded-lg p-3 text-white"
        >
          <div className="font-bold text-[10px] uppercase tracking-wide mb-1 opacity-80">Presentation Layer</div>
          <div className="flex gap-2 flex-wrap">
            <span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">Streamlit UI</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">Auth0 SSO</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">Multi-tenant</span>
          </div>
        </motion.div>

        {/* Feature Modules */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg p-3 text-white"
        >
          <div className="font-bold text-[10px] uppercase tracking-wide mb-1 opacity-80">Feature Modules</div>
          <div className="grid grid-cols-4 gap-1">
            {["DAG Monitor", "Fleet", "Trip Anomalies", "TPMS", "Lambdas", "Tracker", "Sensors"].map(m => (
              <span key={m} className="bg-white/20 px-1.5 py-0.5 rounded text-[8px] text-center">{m}</span>
            ))}
          </div>
        </motion.div>

        {/* Data Access Layer */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg p-3 text-white"
        >
          <div className="font-bold text-[10px] uppercase tracking-wide mb-1 opacity-80">Data Fetchers</div>
          <div className="flex gap-2 flex-wrap">
            <span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">Athena</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">DynamoDB</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">PostgreSQL</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">SQS</span>
          </div>
        </motion.div>

        {/* Infrastructure */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-lg p-3 text-white"
        >
          <div className="font-bold text-[10px] uppercase tracking-wide mb-1 opacity-80">AWS Infrastructure</div>
          <div className="flex gap-2 flex-wrap">
            <span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">MWAA (Airflow)</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">CloudWatch</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">IAM Roles</span>
          </div>
        </motion.div>
      </div>

      {/* Flow Arrows */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Decorative connection lines would go here */}
      </div>
    </div>
  )
}

export function XRadarLLD() {
  return (
    <div className="w-full h-full flex flex-col gap-3 p-4 text-xs overflow-auto">
      <div className="text-center mb-2">
        <h4 className="text-sm font-bold text-slate-800">Low-Level Design</h4>
        <p className="text-[10px] text-slate-500">Component Architecture</p>
      </div>

      {/* Component Diagram */}
      <div className="grid grid-cols-3 gap-2 flex-1">
        {/* Scheduler */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="col-span-1 bg-slate-800 rounded-lg p-2 text-white"
        >
          <div className="text-[9px] font-bold text-violet-400 mb-1">scheduler/</div>
          <div className="space-y-1 text-[8px] text-slate-300">
            <div>• SchedulerInitializer</div>
            <div>• Background Jobs</div>
            <div>• Cache Refresh</div>
          </div>
        </motion.div>

        {/* Components */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="col-span-1 bg-slate-800 rounded-lg p-2 text-white"
        >
          <div className="text-[9px] font-bold text-blue-400 mb-1">components/</div>
          <div className="space-y-1 text-[8px] text-slate-300">
            <div>• AuthProvider</div>
            <div>• Sidebar Navigation</div>
            <div>• Pipeline Runner</div>
            <div>• Health Monitor</div>
          </div>
        </motion.div>

        {/* Utils */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="col-span-1 bg-slate-800 rounded-lg p-2 text-white"
        >
          <div className="text-[9px] font-bold text-emerald-400 mb-1">utils/</div>
          <div className="space-y-1 text-[8px] text-slate-300">
            <div>• AWS Client</div>
            <div>• Slack Integration</div>
            <div>• Spinner Utils</div>
          </div>
        </motion.div>

        {/* Monitoring Features */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="col-span-3 bg-slate-800 rounded-lg p-2 text-white"
        >
          <div className="text-[9px] font-bold text-amber-400 mb-1">features/monitoring/</div>
          <div className="grid grid-cols-4 gap-1 text-[8px] text-slate-300">
            <div>• dags.py</div>
            <div>• lambdas.py</div>
            <div>• fleet.py</div>
            <div>• anomalies.py</div>
            <div>• tpms.py</div>
            <div>• tracker.py</div>
            <div>• sensors.py</div>
          </div>
        </motion.div>
      </div>

      {/* Data Flow */}
      <div className="bg-slate-100 rounded-lg p-2 mt-2">
        <div className="text-[9px] font-bold text-slate-600 mb-1">Data Flow</div>
        <div className="flex items-center gap-1 text-[8px] text-slate-500">
          <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">UI</span>
          <span>→</span>
          <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Feature</span>
          <span>→</span>
          <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Fetcher</span>
          <span>→</span>
          <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">AWS</span>
        </div>
      </div>
    </div>
  )
}


// ===========================
// CSM-SSO-PLUGIN ARCHITECTURE
// ===========================
export function CSMSSOPluginHLD() {
  return (
    <div className="w-full h-full flex flex-col gap-3 p-4 text-xs">
      <div className="text-center">
        <h4 className="text-sm font-bold text-slate-800">High-Level Design</h4>
        <p className="text-[10px] text-slate-500">SSO Automation Flow</p>
      </div>

      {/* Architecture Flow */}
      <div className="flex-1 flex flex-col justify-center gap-3">
        {/* User Layer */}
        <motion.div 
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="flex items-center gap-3"
        >
          <div className="bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg p-3 text-white flex-1">
            <div className="font-bold text-[10px]">Browser Extension</div>
            <div className="text-[8px] opacity-80">Chrome/Chromium UI Layer</div>
          </div>
          <div className="text-slate-400 text-lg">→</div>
          <div className="bg-gradient-to-r from-slate-700 to-slate-800 rounded-lg p-3 text-white flex-1">
            <div className="font-bold text-[10px]">Go Backend</div>
            <div className="text-[8px] opacity-80">Local Server :52920</div>
          </div>
        </motion.div>

        {/* API Layer */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex gap-3"
        >
          <div className="flex-1 bg-gradient-to-r from-violet-500 to-purple-500 rounded-lg p-3 text-white">
            <div className="font-bold text-[10px]">CipherTrust Manager</div>
            <div className="text-[8px] opacity-80">CSM Tile Configuration</div>
          </div>
          <div className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg p-3 text-white">
            <div className="font-bold text-[10px]">Akeyless</div>
            <div className="text-[8px] opacity-80">JWT Auth + Access Roles</div>
          </div>
        </motion.div>

        {/* Process Steps */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-slate-100 rounded-lg p-3"
        >
          <div className="font-bold text-[9px] text-slate-700 mb-2">SSO Setup Flow</div>
          <div className="flex items-center gap-1 flex-wrap text-[8px]">
            {["Initialize", "Fetch JWKS", "Create JWT Auth", "Create Role", "Set Rules", "Associate", "Enable CSM"].map((step, i) => (
              <React.Fragment key={step}>
                <span className="bg-violet-500 text-white px-1.5 py-0.5 rounded">{step}</span>
                {i < 6 && <span className="text-slate-400">→</span>}
              </React.Fragment>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export function CSMSSOPluginLLD() {
  return (
    <div className="w-full h-full flex flex-col gap-3 p-4 text-xs overflow-auto">
      <div className="text-center mb-2">
        <h4 className="text-sm font-bold text-slate-800">Low-Level Design</h4>
        <p className="text-[10px] text-slate-500">Backend Service Architecture</p>
      </div>

      <div className="grid grid-cols-2 gap-2 flex-1">
        {/* Handlers */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-slate-800 rounded-lg p-2 text-white"
        >
          <div className="text-[9px] font-bold text-blue-400 mb-1">handlers/ (12 endpoints)</div>
          <div className="grid grid-cols-2 gap-1 text-[7px] text-slate-300">
            <div>• /initialize</div>
            <div>• /csm-service</div>
            <div>• /create-connection</div>
            <div>• /fetch-jwks</div>
            <div>• /auth-akeyless</div>
            <div>• /create-jwt-auth</div>
            <div>• /create-access-role</div>
            <div>• /set-role-rule</div>
            <div>• /associate-role</div>
            <div>• /update-config</div>
            <div>• /check-status</div>
            <div>• /delete-token</div>
          </div>
        </motion.div>

        {/* Services */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-800 rounded-lg p-2 text-white"
        >
          <div className="text-[9px] font-bold text-emerald-400 mb-1">services/ (9 modules)</div>
          <div className="space-y-1 text-[8px] text-slate-300">
            <div>• tokens.go - Token management</div>
            <div>• roles.go - Access role CRUD</div>
            <div>• jwt_auth.go - JWT methods</div>
            <div>• connections.go - CSM connection</div>
            <div>• enable.go - CSM tile enable</div>
            <div>• jwks.go - JWKS fetching</div>
            <div>• rules.go - Role rule config</div>
            <div>• status.go - Health checks</div>
            <div>• config.go - Configuration</div>
          </div>
        </motion.div>

        {/* Extension */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="col-span-2 bg-slate-800 rounded-lg p-2 text-white"
        >
          <div className="text-[9px] font-bold text-violet-400 mb-1">extension/ (Chrome)</div>
          <div className="flex gap-3 text-[8px] text-slate-300">
            <div className="flex-1">
              <div className="text-violet-400 text-[7px] mb-1">popup.js</div>
              <div>• Form handlers</div>
              <div>• API orchestration</div>
              <div>• Status polling</div>
            </div>
            <div className="flex-1">
              <div className="text-violet-400 text-[7px] mb-1">popup.html</div>
              <div>• Input forms</div>
              <div>• Status display</div>
              <div>• Error handling</div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* API Flow */}
      <div className="bg-slate-100 rounded-lg p-2">
        <div className="text-[9px] font-bold text-slate-600 mb-1">Request Flow</div>
        <div className="flex items-center gap-1 text-[8px] text-slate-500">
          <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Extension</span>
          <span>→</span>
          <span className="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">Handler</span>
          <span>→</span>
          <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Service</span>
          <span>→</span>
          <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">External API</span>
        </div>
      </div>
    </div>
  )
}


// ===========================
// X-SANITY ARCHITECTURE
// ===========================
export function XSanityHLD() {
  return (
    <div className="w-full h-full flex flex-col gap-3 p-4 text-xs">
      <div className="text-center">
        <h4 className="text-sm font-bold text-slate-800">High-Level Design</h4>
        <p className="text-[10px] text-slate-500">Distributed Sanity Testing</p>
      </div>

      <div className="flex-1 flex flex-col justify-center gap-3">
        {/* Trigger Layer */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg p-3 text-white"
        >
          <div className="font-bold text-[10px]">Deployment Trigger</div>
          <div className="flex gap-2 mt-1 text-[8px]">
            <span className="bg-white/20 px-2 py-0.5 rounded">CI/CD Pipeline</span>
            <span className="bg-white/20 px-2 py-0.5 rounded">Manual Trigger</span>
            <span className="bg-white/20 px-2 py-0.5 rounded">Scheduled</span>
          </div>
        </motion.div>

        {/* Test Orchestration */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg p-3 text-white"
        >
          <div className="font-bold text-[10px]">Test Orchestrator</div>
          <div className="flex gap-2 mt-1 text-[8px]">
            <span className="bg-white/20 px-2 py-0.5 rounded">Test Discovery</span>
            <span className="bg-white/20 px-2 py-0.5 rounded">Parallel Execution</span>
            <span className="bg-white/20 px-2 py-0.5 rounded">Result Aggregation</span>
          </div>
        </motion.div>

        {/* Test Domains */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-3 gap-2"
        >
          <div className="bg-gradient-to-b from-orange-500 to-amber-500 rounded-lg p-2 text-white text-center">
            <div className="font-bold text-[9px]">Firmware</div>
            <div className="text-[7px] opacity-80">Hardware Tests</div>
          </div>
          <div className="bg-gradient-to-b from-purple-500 to-violet-500 rounded-lg p-2 text-white text-center">
            <div className="font-bold text-[9px]">Cloud</div>
            <div className="text-[7px] opacity-80">API Tests</div>
          </div>
          <div className="bg-gradient-to-b from-pink-500 to-rose-500 rounded-lg p-2 text-white text-center">
            <div className="font-bold text-[9px]">Integration</div>
            <div className="text-[7px] opacity-80">E2E Tests</div>
          </div>
        </motion.div>

        {/* Reporting */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-slate-100 rounded-lg p-3"
        >
          <div className="font-bold text-[9px] text-slate-700">Reporting & Notifications</div>
          <div className="flex gap-2 mt-1 text-[8px] text-slate-600">
            <span className="bg-slate-200 px-2 py-0.5 rounded">Slack Alerts</span>
            <span className="bg-slate-200 px-2 py-0.5 rounded">Test Reports</span>
            <span className="bg-slate-200 px-2 py-0.5 rounded">Metrics Dashboard</span>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export function XSanityLLD() {
  return (
    <div className="w-full h-full flex flex-col gap-3 p-4 text-xs overflow-auto">
      <div className="text-center mb-2">
        <h4 className="text-sm font-bold text-slate-800">Low-Level Design</h4>
        <p className="text-[10px] text-slate-500">Test Framework Architecture</p>
      </div>

      <div className="grid grid-cols-2 gap-2 flex-1">
        {/* Test Runner */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-slate-800 rounded-lg p-2 text-white"
        >
          <div className="text-[9px] font-bold text-green-400 mb-1">tests/</div>
          <div className="space-y-1 text-[8px] text-slate-300">
            <div>• test_firmware.py</div>
            <div>• test_cloud_api.py</div>
            <div>• test_integration.py</div>
            <div>• conftest.py</div>
          </div>
        </motion.div>

        {/* Core Modules */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-800 rounded-lg p-2 text-white"
        >
          <div className="text-[9px] font-bold text-blue-400 mb-1">core/</div>
          <div className="space-y-1 text-[8px] text-slate-300">
            <div>• orchestrator.py</div>
            <div>• executor.py</div>
            <div>• reporter.py</div>
            <div>• notifier.py</div>
          </div>
        </motion.div>

        {/* Config & Utils */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="col-span-2 bg-slate-800 rounded-lg p-2 text-white"
        >
          <div className="text-[9px] font-bold text-amber-400 mb-1">Infrastructure</div>
          <div className="grid grid-cols-3 gap-2 text-[8px] text-slate-300">
            <div>
              <div className="text-amber-400 text-[7px] mb-1">config/</div>
              <div>• settings.yaml</div>
              <div>• environments.py</div>
            </div>
            <div>
              <div className="text-amber-400 text-[7px] mb-1">docker/</div>
              <div>• Dockerfile</div>
              <div>• docker-compose.yml</div>
            </div>
            <div>
              <div className="text-amber-400 text-[7px] mb-1">ci/</div>
              <div>• Jenkinsfile</div>
              <div>• deploy.sh</div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Test Flow */}
      <div className="bg-slate-100 rounded-lg p-2">
        <div className="text-[9px] font-bold text-slate-600 mb-1">Execution Flow</div>
        <div className="flex items-center gap-1 text-[8px] text-slate-500">
          <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Trigger</span>
          <span>→</span>
          <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Discover</span>
          <span>→</span>
          <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Execute</span>
          <span>→</span>
          <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Report</span>
        </div>
      </div>
    </div>
  )
}

