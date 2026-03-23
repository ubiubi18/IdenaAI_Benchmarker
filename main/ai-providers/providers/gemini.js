const {stripDataUrl} = require('../decision')

async function callGemini({httpClient, apiKey, model, flip, prompt, profile}) {
  const left = stripDataUrl(flip.leftImage)
  const right = stripDataUrl(flip.rightImage)

  const response = await httpClient.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      contents: [
        {
          role: 'user',
          parts: [{text: prompt}, {inlineData: left}, {inlineData: right}],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: profile.maxOutputTokens,
        responseMimeType: 'application/json',
      },
    },
    {
      timeout: profile.requestTimeoutMs,
    }
  )

  const candidates = response && response.data && response.data.candidates
  const firstCandidate = Array.isArray(candidates) && candidates[0]
  const content = firstCandidate && firstCandidate.content
  const parts = (content && content.parts) || []

  return parts
    .map((part) => part && part.text)
    .filter(Boolean)
    .join('\n')
}

async function testGeminiProvider({httpClient, apiKey, model, profile}) {
  await httpClient.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      contents: [
        {role: 'user', parts: [{text: 'Reply with JSON: {"ok":true}'}]},
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 16,
      },
    },
    {
      timeout: profile.requestTimeoutMs,
    }
  )
}

module.exports = {
  callGemini,
  testGeminiProvider,
}
