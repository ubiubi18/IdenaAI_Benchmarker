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

function buildReportabilityRules() {
  return [
    '- Treat the flip as report-worthy if solving it clearly requires reading text.',
    '- Treat the flip as report-worthy if visible order labels, letters, numbers, arrows, captions, or sequence markers are placed on top of the images.',
    '- Treat the flip as report-worthy if it contains inappropriate, NSFW, or graphic violent content.',
  ].join('\n')
}

function buildCompositePrompt({
  hash,
  allowedAnswers,
  uncertaintyRule,
  passRule,
  repromptRule,
}) {
  const reportabilityRules = buildReportabilityRules()
  return `
You are solving an Idena short-session flip benchmark.
You are given one 2x2 composite image with four panels:
- Panel 1 = top-left
- Panel 2 = top-right
- Panel 3 = bottom-left
- Panel 4 = bottom-right

Two candidate story orders are proposed:
- LEFT order
- RIGHT order

Task:
1) Inspect each panel separately and identify the main actors, actions, and visible state.
2) If any readable text appears, transcribe it and translate it to English if needed.
3) Mentally simulate LEFT and RIGHT as chronological stories.
4) Choose the story with the clearest causal chain and consistent entity progression.
5) Return JSON only.

Allowed JSON schema:
{"answer":"left|right|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
- Candidate side labels are arbitrary. Do not use position or label frequency as a hint.
- Keep reasoning concise and factual, and mention one concrete visual cue when possible.
${reportabilityRules}
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
  const reportabilityRules = buildReportabilityRules()
  return `
You are solving an Idena short-session flip benchmark.
You are given 8 ordered frame images:
- Images 1-4 belong to the LEFT story (in temporal order)
- Images 5-8 belong to the RIGHT story (in temporal order)

Task:
1) Inspect each frame separately and identify actors, actions, and visible state changes.
2) If any readable text appears, transcribe it and translate it to English if needed.
3) Build one short story summary for LEFT and one short story summary for RIGHT.
4) Compare coherence using common-sense chronology and visible cause -> effect links.
5) Choose the most meaningful story.
6) Return JSON only.

Allowed JSON schema:
{"answer":"left|right|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
- Do not use LEFT/RIGHT label identity or candidate position as a hint.
- Keep reasoning concise and factual, and mention one concrete visual cue when possible.
${reportabilityRules}
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
1) For each frame, write one short factual caption.
2) Extract any readable text from each frame and translate it to English if needed.
3) Build one concise story summary for LEFT and RIGHT.
4) Estimate one coherence score from 0 to 100 for LEFT and RIGHT.
5) Flag report risk if the flip is clearly report-worthy.
6) Return JSON only.

Allowed JSON schema:
{
  "leftFrames":[
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."}
  ],
  "rightFrames":[
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."}
  ],
  "leftStory":"...",
  "rightStory":"...",
  "coherenceLeft":0,
  "coherenceRight":0,
  "reportRisk": false,
  "reportReason":""
}

Rules:
- Keep each frame caption short and factual
- Use "" for text and translation when no readable text exists
- Keep story summaries concise
- coherence scores must be integers between 0 and 100
- Set reportRisk=true if reading text is required to solve the flip
- Set reportRisk=true if visible order labels, numbers, letters, arrows, captions, or sequence markers appear on the images
- Set reportRisk=true if the flip contains inappropriate, NSFW, or graphic violent content
- Do not use LEFT/RIGHT label identity as a hint when comparing stories

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
  const reportabilityRules = buildReportabilityRules()
  return `
You are solving an Idena short-session flip benchmark.
You are given pre-analysis JSON for LEFT and RIGHT story frames.

Task:
1) Read the captions, extracted text, translations, story summaries, coherence scores, and report flags.
2) If reportRisk is true, return skip unless the report signal is clearly invalid.
3) Otherwise, choose the story with the better coherence and clearer causal chain.
4) Prefer skip when both stories are similarly weak or ambiguous.
5) Return JSON only.

Allowed JSON schema:
{"answer":"left|right|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
- Keep reasoning concise and factual, and cite one key caption or reportability signal
${reportabilityRules}
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
