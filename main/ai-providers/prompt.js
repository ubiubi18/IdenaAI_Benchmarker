function promptTemplate({hash}) {
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
- Use only left/right/skip for "answer"
- "confidence" must be between 0 and 1
- Keep reasoning concise and factual
- If uncertain, return "skip"

Flip hash: ${hash}
`.trim()
}

module.exports = {
  promptTemplate,
}
