function renderPromptOverride(template, variables = {}) {
  let rendered = String(template || '')
  Object.entries(variables).forEach(([key, value]) => {
    const token = `{{${key}}}`
    rendered = rendered.split(token).join(String(value))
  })
  return rendered.trim()
}

function truncateText(value, maxLength = 12000) {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }
  return text.length <= maxLength ? text : text.slice(0, maxLength)
}

function normalizeVisionMode(value) {
  const mode = String(value || '')
    .trim()
    .toLowerCase()

  if (['composite', 'frames_single_pass', 'frames_two_pass'].includes(mode)) {
    return mode
  }
  return 'composite'
}

function normalizePromptPhase(value) {
  const phase = String(value || '')
    .trim()
    .toLowerCase()

  if (
    ['decision', 'frame_reasoning', 'decision_from_frame_reasoning'].includes(
      phase
    )
  ) {
    return phase
  }
  return 'decision'
}

function buildAllowedAnswers(forceDecision) {
  return forceDecision ? 'left|right' : 'left|right|skip'
}

function buildDecisionRules({forceDecision, secondPass, repromptRule}) {
  const allowedAnswers = buildAllowedAnswers(forceDecision)
  const uncertaintyRule = forceDecision
    ? '- You must choose left or right. Do not return skip.'
    : '- If uncertain, return "skip"'
  const passRule = secondPass
    ? '- This is a second-pass uncertainty review. Re-check both sides carefully before deciding.'
    : '- This is the first-pass decision.'

  return {
    allowedAnswers,
    uncertaintyRule,
    passRule,
    repromptRule: String(repromptRule || '').trim(),
  }
}

function buildCompositePrompt({
  hash,
  allowedAnswers,
  uncertaintyRule,
  passRule,
  repromptRule,
}) {
  return `
You are solving an Idena short-session flip benchmark.
You are given two candidate stories of the same 4 images:
- LEFT story image
- RIGHT story image

Task:
1) Choose the most meaningful story.
2) Return JSON only.

Allowed JSON schema:
{"answer":"left|right|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
- Keep reasoning concise and factual
${uncertaintyRule}
${passRule}
${repromptRule ? `- Extra instruction: ${repromptRule}` : ''}

Flip hash: ${hash}
`.trim()
}

function buildFramesSinglePassPrompt({
  hash,
  allowedAnswers,
  uncertaintyRule,
  passRule,
  repromptRule,
}) {
  return `
You are solving an Idena short-session flip benchmark.
You are given 8 ordered frame images:
- Images 1-4 belong to the LEFT story (in temporal order)
- Images 5-8 belong to the RIGHT story (in temporal order)

Task:
1) Analyze each frame separately.
2) Build a short narrative for LEFT and RIGHT.
3) Choose the most meaningful story.
4) Return JSON only.

Allowed JSON schema:
{"answer":"left|right|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
- Keep reasoning concise and factual
${uncertaintyRule}
${passRule}
${repromptRule ? `- Extra instruction: ${repromptRule}` : ''}

Flip hash: ${hash}
`.trim()
}

function buildFramesReasoningPrompt({hash}) {
  return `
You are solving an Idena flip benchmark in analysis mode.
You are given 8 ordered frame images:
- Images 1-4 belong to the LEFT story (in temporal order)
- Images 5-8 belong to the RIGHT story (in temporal order)

Task:
1) Caption each frame in one short factual sentence.
2) Build one concise story summary for LEFT and RIGHT.
3) Return JSON only.

Allowed JSON schema:
{
  "leftFrames":["...", "...", "...", "..."],
  "rightFrames":["...", "...", "...", "..."],
  "leftStory":"...",
  "rightStory":"...",
  "confidenceLeft":0.0,
  "confidenceRight":0.0
}

Rules:
- Keep each frame caption short and factual
- Keep story summaries concise
- confidence values must be between 0 and 1

Flip hash: ${hash}
`.trim()
}

function buildFramesDecisionPrompt({
  hash,
  frameReasoning,
  allowedAnswers,
  uncertaintyRule,
  passRule,
  repromptRule,
}) {
  return `
You are solving an Idena short-session flip benchmark.
You are given pre-analysis JSON for LEFT and RIGHT story frames.

Task:
1) Use the pre-analysis to select the better story.
2) Return JSON only.

Allowed JSON schema:
{"answer":"left|right|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
- Keep reasoning concise and factual
${uncertaintyRule}
${passRule}
${repromptRule ? `- Extra instruction: ${repromptRule}` : ''}

Flip hash: ${hash}

Pre-analysis JSON:
${truncateText(frameReasoning)}
`.trim()
}

function promptTemplate({
  hash,
  forceDecision = false,
  secondPass = false,
  promptTemplateOverride = '',
  uncertaintyRepromptInstruction = '',
  flipVisionMode = 'composite',
  promptPhase = 'decision',
  frameReasoning = '',
}) {
  const mode = normalizeVisionMode(flipVisionMode)
  const phase = normalizePromptPhase(promptPhase)
  const repromptRule = String(uncertaintyRepromptInstruction || '').trim()
  const customTemplate = String(promptTemplateOverride || '').trim()
  const {allowedAnswers, uncertaintyRule, passRule} = buildDecisionRules({
    forceDecision,
    secondPass,
    repromptRule,
  })

  if (customTemplate && phase === 'decision') {
    return renderPromptOverride(customTemplate, {
      hash,
      allowSkip: forceDecision ? 'false' : 'true',
      secondPass: secondPass ? 'true' : 'false',
      allowedAnswers,
      visionMode: mode,
      promptPhase: phase,
    })
  }

  if (phase === 'frame_reasoning') {
    return buildFramesReasoningPrompt({hash})
  }

  if (phase === 'decision_from_frame_reasoning') {
    return buildFramesDecisionPrompt({
      hash,
      frameReasoning,
      allowedAnswers,
      uncertaintyRule,
      passRule,
      repromptRule,
    })
  }

  if (mode === 'composite') {
    return buildCompositePrompt({
      hash,
      allowedAnswers,
      uncertaintyRule,
      passRule,
      repromptRule,
    })
  }

  return buildFramesSinglePassPrompt({
    hash,
    allowedAnswers,
    uncertaintyRule,
    passRule,
    repromptRule,
  })
}

module.exports = {
  promptTemplate,
}
