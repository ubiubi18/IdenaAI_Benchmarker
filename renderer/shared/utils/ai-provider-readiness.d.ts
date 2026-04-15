export type LocalAiSettingsLike = {
  enabled?: boolean
  endpoint?: string
  baseUrl?: string
  runtimeMode?: string
  runtimeType?: string
  runtimeBackend?: string
  reasonerBackend?: string
  visionBackend?: string
  publicModelId?: string
  publicVisionId?: string
  contractVersion?: string
  model?: string
  visionModel?: string
}

export type AiSolverLike = {
  provider?: string
  legacyHeuristicEnabled?: boolean
  legacyHeuristicOnly?: boolean
  ensembleEnabled?: boolean
  ensembleProvider2Enabled?: boolean
  ensembleProvider2?: string
  ensembleProvider3Enabled?: boolean
  ensembleProvider3?: string
}

export type LocalAiRuntimePayload = {
  enabled: boolean
  refresh: boolean
  mode: string
  runtimeType: string
  runtimeBackend: string
  reasonerBackend: string
  visionBackend: string
  publicModelId: string
  publicVisionId: string
  contractVersion: string
  baseUrl: string
  endpoint: string
  model: string
  visionModel: string
}

export type ProviderState = {
  provider: string
  hasKey: boolean
  error: string
}

export type AiBridge = {
  hasProviderKey(args: {provider: string}): Promise<{hasKey?: boolean}>
}

export type LocalAiBridge = {
  status(payload: LocalAiRuntimePayload): Promise<{
    enabled?: boolean
    sidecarReachable?: boolean
    error?: string
    lastError?: string
  }>
}

export type ProviderReadinessResult = {
  checked: true
  checking: false
  activeProvider: string
  requiredProviders: string[]
  missingProviders: string[]
  hasKey: boolean
  allReady: boolean
  primaryReady: boolean
  providerStates: Record<string, ProviderState>
  error: string
}

export const LOCAL_AI_PROVIDER: 'local-ai'

export function normalizeAiProviderId(
  value: unknown,
  fallback?: string
): string
export function isLocalAiProvider(value: unknown): boolean
export function formatAiProviderLabel(value: unknown): string
export function buildLocalAiRuntimePayload(
  localAi?: LocalAiSettingsLike
): LocalAiRuntimePayload
export function resolveLocalAiProviderState(params?: {
  localBridge?: LocalAiBridge
  localAi?: LocalAiSettingsLike
}): Promise<ProviderState>
export function getRequiredAiProviders(aiSolver?: AiSolverLike): string[]
export function formatMissingAiProviders(missingProviders?: string[]): string
export function checkAiProviderReadiness(params?: {
  bridge?: AiBridge
  localBridge?: LocalAiBridge
  localAi?: LocalAiSettingsLike
  aiSolver?: AiSolverLike
}): Promise<ProviderReadinessResult>
