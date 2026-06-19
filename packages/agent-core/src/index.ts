export {
  RiskEngine,
  type RiskTier,
  type RiskPortfolioState,
  type RiskInput,
  type RiskDecision
} from './risk/risk-engine.js';

export {
  PriceState,
  computeConfidenceBreakdown,
  type RouteType,
  type PriceBundle
} from './valuation/price-types.js';

export {
  PriceObservationService,
  type SwapInput,
  WBNB_ADDRESS,
  BSC_STABLES
} from './valuation/price-observation-service.js';

export {
  PriceAggregator
} from './valuation/price-aggregator.js';

export {
  PriceService
} from './valuation/price-service.js';

export {
  type PositionValuation,
  type PortfolioValuation,
  type PortfolioStateSnapshot,
  toRiskPortfolioState
} from './portfolio/portfolio-types.js';

export {
  PortfolioValuationEngine
} from './portfolio/portfolio-valuation-engine.js';

export {
  PortfolioStateService,
  type PortfolioStateConfig
} from './portfolio/portfolio-state-service.js';

// ── Phase 7: Decision Engine ──────────────────────────────────────────────

export {
  type TradeRecommendation,
  type AgentPosition,
  type RankedOpportunity,
  type CapitalAllocation,
  type ExecutionPlan,
  type SkippedSignal,
  type RecommendationAction,
  type RecommendationStatus,
  type PositionStatus,
  type CloseReason,
} from './decision/trade-recommendation-types.js';

export {
  rankOpportunities,
  type RankInput,
} from './decision/decision-ranking.js';

export {
  allocateCapital,
} from './decision/capital-allocator.js';

export {
  buildExecutionPlan,
  buildExecutionPlans,
} from './decision/execution-planner.js';

export {
  DecisionEngine,
  type DecisionEngineConfig,
  type DecisionCycleResult,
} from './decision/decision-engine.js';

export {
  PositionRegistryService,
} from './position/position-registry-service.js';

