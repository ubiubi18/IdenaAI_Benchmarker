const {callAnthropic} = require('./anthropic')

describe('anthropic provider adapter', () => {
  test('uses a generous provider-required max_tokens fallback in auto mode', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          content: [
            {type: 'text', text: '{"answer":"right","confidence":0.7}'},
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 5,
          },
        },
      }),
    }

    await callAnthropic({
      httpClient,
      apiKey: 'test-key',
      model: 'claude-3-7-sonnet-latest',
      flip: {
        hash: 'flip-1',
      },
      prompt: 'Decide left or right',
      profile: {
        temperature: 0,
        maxOutputTokens: 0,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
    })

    expect(httpClient.post).toHaveBeenCalledTimes(1)
    expect(httpClient.post.mock.calls[0][1].max_tokens).toBe(1024)
  })
})
