function createStoryValidatorHooks(hooks = {}) {
  const source = hooks && typeof hooks === 'object' ? hooks : {}
  return {
    ocrTextCheck:
      typeof source.ocrTextCheck === 'function' ? source.ocrTextCheck : null,
    keywordVisibilityCheck:
      typeof source.keywordVisibilityCheck === 'function'
        ? source.keywordVisibilityCheck
        : null,
    alignmentCheck:
      typeof source.alignmentCheck === 'function' ? source.alignmentCheck : null,
    policyRiskCheck:
      typeof source.policyRiskCheck === 'function'
        ? source.policyRiskCheck
        : null,
  }
}

function normalizeHookResult(value) {
  if (value === true) {
    return {status: 'pass', detail: '', data: null}
  }
  if (value === false) {
    return {status: 'fail', detail: '', data: null}
  }
  if (!value || typeof value !== 'object') {
    return {status: 'pass', detail: '', data: null}
  }

  const status = String(value.status || value.outcome || 'pass')
    .trim()
    .toLowerCase()
  const normalizedStatus = ['pass', 'warn', 'fail', 'error'].includes(status)
    ? status
    : 'pass'

  return {
    status: normalizedStatus,
    detail: String(value.detail || value.reason || '').trim(),
    data:
      value.data && typeof value.data === 'object' && !Array.isArray(value.data)
        ? value.data
        : null,
  }
}

async function runStoryValidatorHooks({
  hooks = null,
  stories = [],
  context = {},
}) {
  const configured = createStoryValidatorHooks(hooks)
  const hookEntries = [
    ['ocr_text_check', configured.ocrTextCheck],
    ['keyword_visibility_check', configured.keywordVisibilityCheck],
    ['alignment_check', configured.alignmentCheck],
    ['policy_risk_check', configured.policyRiskCheck],
  ]

  const results = {}
  for (const [name, handler] of hookEntries) {
    if (typeof handler !== 'function') {
      results[name] = {status: 'not_configured', detail: '', data: null}
      continue
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const output = await handler({
        stories,
        context,
      })
      results[name] = normalizeHookResult(output)
    } catch (error) {
      results[name] = {
        status: 'error',
        detail: String((error && error.message) || error || '').trim(),
        data: null,
      }
    }
  }

  return results
}

module.exports = {
  createStoryValidatorHooks,
  runStoryValidatorHooks,
}
