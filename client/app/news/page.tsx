'use client'

import { useState } from 'react'
import TopNavigation from '@/components/navigation/top-nav'
import { mockResearchArticles } from '@/lib/mock-data'

export default function NewsPage() {
  const [selectedCategory, setSelectedCategory] = useState('all')

  const categories = ['All', 'Market', 'On-Chain', 'Whales', 'Signals', 'AI Analysis']

  const articles = [
    {
      id: 1,
      category: 'Market',
      title: 'Bitcoin Reaches $109K - Institutional Interest Surges',
      summary: 'Major cryptocurrency milestone as BTC breaks through $109,000 with record trading volumes on regulated exchanges.',
      source: 'Market Analysis',
      timestamp: '2 hours ago',
    },
    {
      id: 2,
      category: 'On-Chain',
      title: 'Smart Wallet Accumulation Reaches 6-Month High',
      summary: 'On-chain metrics show intelligent traders accumulating across major token pairs as conviction builds.',
      source: 'On-Chain Research',
      timestamp: '4 hours ago',
    },
    {
      id: 3,
      category: 'Whales',
      title: 'Whale Alert: $85M ETH Transfer to Exchange',
      summary: 'Large holder moves significant Ethereum position, potentially signaling upcoming market movement.',
      source: 'Chain Analytics',
      timestamp: '6 hours ago',
    },
    {
      id: 4,
      category: 'Signals',
      title: 'CAKE Signal Upgraded to Strong Buy',
      summary: 'PancakeSwap enters strong conviction territory with 92-point signal score backed by wallet analysis.',
      source: 'Signal Generator',
      timestamp: '8 hours ago',
    },
    {
      id: 5,
      category: 'AI Analysis',
      title: 'Machine Learning Model Identifies 7 Emerging Opportunities',
      summary: 'Toru AI identifies tokens with strong fundamentals and positive momentum indicators.',
      source: 'Toru Intelligence',
      timestamp: '10 hours ago',
    },
    {
      id: 6,
      category: 'Market',
      title: 'Altseason Indicators Turning Positive',
      summary: 'Market rotation from large-cap to mid-cap tokens accelerates, suggesting new market cycle phase.',
      source: 'Market Analysis',
      timestamp: '12 hours ago',
    },
  ]

  const filteredArticles =
    selectedCategory === 'all' ? articles : articles.filter((a) => a.category === selectedCategory)

  return (
    <div className="flex flex-col h-screen bg-white">
      <TopNavigation />

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-6">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-950 mb-2">News & Research</h1>
            <p className="text-gray-500">Institutional research hub and market intelligence</p>
          </div>

          {/* Featured Report */}
          <div className="bg-white rounded-lg border border-gray-200 p-8 mb-8">
            <div className="mb-4">
              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                Featured
              </span>
            </div>
            <h2 className="text-2xl font-bold text-gray-950 mb-3">Weekly Smart Money Report</h2>
            <p className="text-gray-600 mb-6">
              Comprehensive analysis of smart wallet movements across major token pairs this week. Includes accumulation
              patterns, conviction scoring, and opportunity identification backed by institutional research.
            </p>
            <button className="px-6 py-2 bg-gray-950 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium">
              Read Full Report
            </button>
          </div>

          {/* Category Filters */}
          <div className="flex gap-2 overflow-x-auto mb-8 pb-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category.toLowerCase())}
                className={`px-4 py-2 rounded-full whitespace-nowrap font-medium transition-colors ${
                  selectedCategory === category.toLowerCase()
                    ? 'bg-gray-950 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          {/* Articles */}
          <div className="space-y-4">
            {filteredArticles.map((article) => (
              <div
                key={article.id}
                className="bg-white rounded-lg border border-gray-200 p-6 hover:border-gray-300 transition-colors cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                    {article.category}
                  </span>
                  <span className="text-xs text-gray-500">{article.timestamp}</span>
                </div>

                <h3 className="text-lg font-semibold text-gray-950 mb-2 group-hover:text-blue-700 transition-colors">
                  {article.title}
                </h3>
                <p className="text-gray-600 mb-4">{article.summary}</p>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">{article.source}</span>
                  <button className="px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium">
                    Read More
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Load More */}
          <div className="text-center mt-8">
            <button className="px-6 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-medium">
              Load More Articles
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
