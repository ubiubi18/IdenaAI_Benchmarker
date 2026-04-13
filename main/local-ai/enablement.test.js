const {
  LOCAL_AI_DISABLED_ERROR,
  isLocalAiEnabled,
  ensureLocalAiEnabled,
} = require('./enablement')

describe('local-ai enablement', () => {
  it('returns true only when localAi.enabled is true', () => {
    expect(isLocalAiEnabled({localAi: {enabled: true}})).toBe(true)
    expect(isLocalAiEnabled({localAi: {enabled: false}})).toBe(false)
    expect(isLocalAiEnabled({})).toBe(false)
  })

  it('throws a stable error when Local AI is disabled', () => {
    expect(() => ensureLocalAiEnabled({localAi: {enabled: false}})).toThrow(
      LOCAL_AI_DISABLED_ERROR
    )
    expect(() => ensureLocalAiEnabled({})).toThrow(LOCAL_AI_DISABLED_ERROR)
  })

  it('does not throw when Local AI is enabled', () => {
    expect(() => ensureLocalAiEnabled({localAi: {enabled: true}})).not.toThrow()
  })
})
