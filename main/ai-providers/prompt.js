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

function systemPromptTemplate() {
  return `
You are a careful visual reasoning judge for the Idena FLIP benchmark.
- Candidate labels such as left/right, option A/B, story 1/2, and first/second are arbitrary placeholders, never evidence.
- Judge only from visible chronology, cause -> effect links, consistent entities, and the final scene state.
- Do not anchor on the first shown candidate or the label wording.
- Return only the requested JSON and no extra prose.
`.trim()
}

function buildAllowedAnswers(forceDecision) {
  return forceDecision ? 'a|b' : 'a|b|skip'
}

function buildDecisionRules({
  forceDecision,
  secondPass,
  finalAdjudication,
  repromptRule,
}) {
  const allowedAnswers = buildAllowedAnswers(forceDecision)
  let uncertaintyRule =
    '- If the evidence is weak or conflicting, return "skip" instead of defaulting to the first shown side.'
  if (forceDecision && finalAdjudication) {
    uncertaintyRule =
      '- You must choose option A or B. If the evidence stays close, assign internal coherence scores and choose the side with any nonzero edge.'
  } else if (forceDecision) {
    uncertaintyRule =
      '- You must choose option A or B. If the evidence stays close, pick the better supported side, but never because it appeared first.'
  }

  let passRule =
    '- This is the first-pass decision. Compare both candidates from scratch before answering.'
  if (finalAdjudication) {
    passRule =
      '- This is the final adjudication pass. Score OPTION A and OPTION B independently from 0 to 100; even 50.5 vs 49.5 is enough to choose the higher-scoring side.'
  } else if (secondPass) {
    passRule =
      '- This is a second-pass uncertainty review. Re-check both sides from scratch and do not anchor on the first listed candidate or your earlier lean.'
  }

  return {
    allowedAnswers,
    uncertaintyRule,
    passRule,
    repromptRule: String(repromptRule || '').trim(),
  }
}

function buildAntiPositionRules() {
  return [
    '- LEFT/RIGHT names, OPTION A/B labels, STORY 1/2 labels, first-vs-second presentation, and candidate slot are arbitrary.',
    '- Candidate order is never evidence.',
    '- Compare story identity, visible chronology, and cause -> effect links, not slot position.',
    '- Never choose a side just because it was shown first.',
  ].join('\n')
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
  const antiPositionRules = buildAntiPositionRules()
  const mustChoose = allowedAnswers === 'a|b'
  return `
You are solving an Idena short-session flip benchmark.
You are given two candidate 2x2 composite images:
- The first attached image is OPTION A
- The second attached image is OPTION B

Each candidate image contains four panels:
- Panel 1 = top-left
- Panel 2 = top-right
- Panel 3 = bottom-left
- Panel 4 = bottom-right

Task:
1) Inspect each panel separately and identify the main actors, actions, and visible state.
2) If any readable text appears, transcribe it and translate it to English if needed.
3) Mentally simulate OPTION A and OPTION B as chronological stories.
4) Choose the story with the clearest causal chain and consistent entity progression.
5) Return JSON only.

Allowed JSON schema:
{"answer":"a|b|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
${antiPositionRules}
- Keep reasoning concise and factual, and mention one concrete visual cue when possible.
${reportabilityRules}
${
  mustChoose
    ? '- In forced answer mode, report risk lowers confidence but must not become "skip". Choose the more coherent side for the answer session.'
    : ''
}
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
  const antiPositionRules = buildAntiPositionRules()
  const mustChoose = allowedAnswers === 'a|b'
  return `
You are solving an Idena short-session flip benchmark.
You are given 8 ordered frame images:
- Images 1-4 belong to OPTION A (in temporal order)
- Images 5-8 belong to OPTION B (in temporal order)

Task:
1) Inspect each frame separately and identify actors, actions, and visible state changes.
2) If any readable text appears, transcribe it and translate it to English if needed.
3) Build one short story summary for OPTION A and one short story summary for OPTION B.
4) Compare coherence using common-sense chronology and visible cause -> effect links.
5) Choose the most meaningful story.
6) Return JSON only.

Allowed JSON schema:
{"answer":"a|b|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
- Keep reasoning concise and factual, and mention one concrete visual cue when possible.
${antiPositionRules}
${reportabilityRules}
${
  mustChoose
    ? '- In forced answer mode, report risk lowers confidence but must not become "skip". Choose the more coherent side for the answer session.'
    : ''
}
${uncertaintyRule}
${passRule}
${repromptRule ? `- Extra instruction: ${repromptRule}` : ''}

Flip hash: ${hash}
`.trim()
}

function buildFramesReasoningPrompt({hash}) {
  const antiPositionRules = buildAntiPositionRules()
  return `
You are solving an Idena flip benchmark in analysis mode.
You are given 8 ordered frame images:
- Images 1-4 belong to OPTION A (in temporal order)
- Images 5-8 belong to OPTION B (in temporal order)

Task:
1) For each frame, write one short factual caption.
2) Extract any readable text from each frame and translate it to English if needed.
3) Build one concise story summary for OPTION A and OPTION B.
4) Estimate one coherence score from 0 to 100 for OPTION A and OPTION B.
5) Flag report risk if the flip is clearly report-worthy.
6) Return JSON only.

Allowed JSON schema:
{
  "optionAFrames":[
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."}
  ],
  "optionBFrames":[
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."}
  ],
  "optionAStory":"...",
  "optionBStory":"...",
  "coherenceA":0,
  "coherenceB":0,
  "reportRisk": false,
  "reportReason":""
}

Rules:
- Keep each frame caption short and factual
- Use "" for text and translation when no readable text exists
- Keep story summaries concise
- coherence scores must be integers between 0 and 100
- Evaluate OPTION A and OPTION B independently before comparing them
- Do not let the first listed side inherit a higher coherence score by default
- Set reportRisk=true if reading text is required to solve the flip
- Set reportRisk=true if visible order labels, numbers, letters, arrows, captions, or sequence markers appear on the images
- Set reportRisk=true if the flip contains inappropriate, NSFW, or graphic violent content
${antiPositionRules}

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
  finalAdjudication,
}) {
  const reportabilityRules = buildReportabilityRules()
  const antiPositionRules = buildAntiPositionRules()
  const mustChoose = allowedAnswers === 'a|b'
  return `
You are solving an Idena short-session flip benchmark.
You are given pre-analysis JSON for OPTION A and OPTION B story frames.

Task:
1) Read the captions, extracted text, translations, story summaries, coherence scores, and report flags.
2) ${
    mustChoose
      ? 'If reportRisk is true, lower confidence and note it, but still choose OPTION A or OPTION B for the answer session.'
      : 'If reportRisk is true, return skip unless the report signal is clearly invalid.'
  }
3) Otherwise, choose the story with the better coherence and clearer causal chain.
4) ${
    mustChoose
      ? 'If both stories are similarly weak or ambiguous, choose the narrowly better supported side and use low confidence.'
      : 'Prefer skip when both stories are similarly weak or ambiguous.'
  }
5) ${
    finalAdjudication
      ? 'For final adjudication, include the approximate OPTION A and OPTION B scores in reasoning, then choose the higher score.'
      : 'Return JSON only.'
  }

Allowed JSON schema:
{"answer":"a|b|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
- Keep reasoning concise and factual, and cite one key caption or reportability signal
${antiPositionRules}
${reportabilityRules}
${
  mustChoose
    ? '- In forced answer mode, never return "skip"; the separate reporting phase handles reports.'
    : ''
}
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
  finalAdjudication = false,
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
    finalAdjudication,
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
      finalAdjudication,
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
  systemPromptTemplate,
  promptTemplate,
}
