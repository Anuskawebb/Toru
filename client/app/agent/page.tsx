'use client'

import { useState, useEffect } from 'react'
import TopNavigation from '@/components/navigation/top-nav'
import RiskBadge from '@/components/shared/risk-badge'
import { fetchAgent, AgentData } from '@/lib/api'
import { Activity, CheckCircle, XCircle, Eye } from 'lucide-react'

export default function AgentPage() {
  const [data, setData] = useState<AgentData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAgent().then((d) => {
      setData(d)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-white">
        <TopNavigation />
        <div className="flex-1 flex items-center justify-center text-gray-500">Loading...</div>
      </div>
    )
  }

  const status = data?.status
  const decisions = data?.decisions ?? []
  const recommendations = data?.recommendations ?? []

  return (
    <div className="flex flex-col h-screen bg-white">
      <TopNavigation />

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-950 mb-2">Toro Agent</h1>
            <p className="text-gray-500">AI-powered trading signal generation and risk management</p>
          </div>

          {/* Status Cards */}
          <div className="grid grid-cols-5 gap-6 mb-8">
            {[
              { label: 'Monitoring Tokens', value: status?.monitoringTokens ?? 0 },
              { label: 'Tracked Wallets', value: status?.trackedWallets ?? 0 },
              { label: 'Signals Generated', value: status?.signalsGenerated ?? 0 },
              { label: 'Recommendations', value: status?.recommendationsActive ?? 0 },
              { label: 'System Status', value: status?.agentStatus ?? 'Unknown', isStatus: true },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">{stat.label}</div>
                {stat.isStatus ? (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-2xl font-bold text-green-700">{stat.value}</span>
                  </div>
                ) : (
                  <div className="text-3xl font-bold text-gray-950">{stat.value}</div>
                )}
              </div>
            ))}
          </div>

          {/* Decision Feed */}
          <div className="grid grid-cols-2 gap-6 mb-8">
            {/* Latest Decisions */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-950 mb-6">Latest Decisions</h3>
              {decisions.length === 0 ? (
                <div className="text-center text-gray-500 py-8">No recent decisions</div>
              ) : (
                <div className="space-y-3">
                  {decisions.map((decision, idx) => (
                    <div key={idx} className="flex items-start gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {decision.action === 'BUY' && <CheckCircle size={18} className="text-green-700" />}
                          {decision.action === 'REJECT' && <XCircle size={18} className="text-red-700" />}
                          {decision.action === 'WATCH' && <Eye size={18} className="text-yellow-700" />}
                          {decision.action === 'SELL' && <XCircle size={18} className="text-red-700" />}
                          {!['BUY', 'REJECT', 'WATCH', 'SELL'].includes(decision.action) && (
                            <Activity size={18} className="text-gray-700" />
                          )}
                          <span className="font-semibold text-gray-950">
                            {decision.action} {decision.token}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{decision.reason}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>{decision.confidence}% confidence</span>
                          {decision.allocation !== '-' && <span>Allocation: {decision.allocation}</span>}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 whitespace-nowrap">
                        {new Date(decision.decidedAt).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Risk Engine Monitor */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-950 mb-6">Risk Engine Monitor</h3>
              <div className="space-y-6">
                {[
                  { label: 'Drawdown', value: '2.1%', status: 'Healthy' },
                  { label: 'Daily Loss', value: '0.8%', status: 'Healthy' },
                  { label: 'Exposure', value: '71.9%', status: 'Balanced' },
                  { label: 'Open Risk', value: '$124K', status: 'Acceptable' },
                  { label: 'Cash Reserve', value: '$500', status: 'Low' },
                ].map((metric) => (
                  <div key={metric.label} className="pb-4 border-b border-gray-200 last:border-b-0">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-gray-950">{metric.label}</span>
                      <span className="text-sm font-semibold text-gray-950">{metric.value}</span>
                    </div>
                    <div className="text-xs text-gray-500">{metric.status}</div>
                  </div>
                ))}
                <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="text-sm font-semibold text-green-700">Risk Status: Healthy</div>
                </div>
              </div>
            </div>
          </div>

          {/* Recommendation Queue */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
            <h3 className="text-lg font-semibold text-gray-950 mb-6">Active Recommendations</h3>
            {recommendations.length === 0 ? (
              <div className="text-center text-gray-500 py-8">No active recommendations</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-6 py-3 font-semibold text-gray-950">Token</th>
                      <th className="text-center px-6 py-3 font-semibold text-gray-950">Action</th>
                      <th className="text-center px-6 py-3 font-semibold text-gray-950">Risk</th>
                      <th className="text-center px-6 py-3 font-semibold text-gray-950">Allocation</th>
                      <th className="text-center px-6 py-3 font-semibold text-gray-950">Stop Loss</th>
                      <th className="text-center px-6 py-3 font-semibold text-gray-950">Take Profit</th>
                      <th className="text-center px-6 py-3 font-semibold text-gray-950">Confidence</th>
                      <th className="text-center px-6 py-3 font-semibold text-gray-950">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendations.map((rec, idx) => (
                      <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-6 py-4 font-medium text-gray-950">{rec.token}</td>
                        <td className={`px-6 py-4 text-center font-semibold ${rec.action === 'BUY' ? 'text-green-700' : 'text-red-700'}`}>
                          {rec.action}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <RiskBadge risk={rec.risk as 'Low' | 'Medium' | 'High'} size="sm" />
                        </td>
                        <td className="px-6 py-4 text-center text-gray-950">{rec.allocation}</td>
                        <td className="px-6 py-4 text-center text-red-700 font-medium">{rec.stopLoss}</td>
                        <td className="px-6 py-4 text-center text-green-700 font-medium">{rec.takeProfit}</td>
                        <td className="px-6 py-4 text-center text-gray-950 font-semibold">{rec.confidence}%</td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            rec.status.toLowerCase() === 'pending'
                              ? 'bg-yellow-50 text-yellow-700'
                              : 'bg-blue-50 text-blue-700'
                          }`}>
                            {rec.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Agent Reasoning Panel */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-950 mb-4">Current Opportunity Analysis</h3>
            <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
              <h4 className="font-semibold text-gray-950 mb-4">
                {recommendations[0] ? `Why ${recommendations[0].token} was selected:` : 'No active opportunities'}
              </h4>
              {recommendations[0] && (
                <ul className="space-y-3">
                  <li className="flex gap-3">
                    <span className="text-green-700 font-bold">✓</span>
                    <span className="text-gray-700">
                      <span className="font-medium">Confidence score</span> — {recommendations[0].confidence}% conviction
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-green-700 font-bold">✓</span>
                    <span className="text-gray-700">
                      <span className="font-medium">Risk tier</span> — {recommendations[0].risk} risk, {recommendations[0].allocation} allocation
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-green-700 font-bold">✓</span>
                    <span className="text-gray-700">
                      <span className="font-medium">Stop loss</span> — {recommendations[0].stopLoss} | Take profit — {recommendations[0].takeProfit}
                    </span>
                  </li>
                </ul>
              )}

              {recommendations[0] && (
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-sm text-blue-900">
                    <span className="font-semibold">Recommended Action:</span>{' '}
                    {recommendations[0].action} {recommendations[0].token} — {recommendations[0].allocation} allocation with{' '}
                    {recommendations[0].stopLoss} stop loss and {recommendations[0].takeProfit} take profit targets.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
