async function callOpenAi({httpClient, apiKey, model, flip, prompt, profile}) {
  const response = await httpClient.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      temperature: 0,
      max_tokens: profile.maxOutputTokens,
      response_format: {
        type: 'json_object',
      },
      messages: [
        {
          role: 'user',
          content: [
            {type: 'text', text: prompt},
            {type: 'image_url', image_url: {url: flip.leftImage}},
            {type: 'image_url', image_url: {url: flip.rightImage}},
          ],
        },
      ],
    },
    {
      timeout: profile.requestTimeoutMs,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  )

  const choices = response && response.data && response.data.choices
  const message = Array.isArray(choices) && choices.length && choices[0].message
  const content = message && message.content

  if (Array.isArray(content)) {
    return content
      .map((part) => part && part.text)
      .filter(Boolean)
      .join('\n')
  }

  return content || ''
}

async function testOpenAiProvider({httpClient, apiKey, model, profile}) {
  await httpClient.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      temperature: 0,
      max_tokens: 8,
      messages: [{role: 'user', content: 'Reply with JSON: {"ok":true}'}],
    },
    {
      timeout: profile.requestTimeoutMs,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  )
}

module.exports = {
  callOpenAi,
  testOpenAiProvider,
}
