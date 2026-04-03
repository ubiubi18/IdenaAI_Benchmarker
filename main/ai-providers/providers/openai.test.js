const {callOpenAi, testOpenAiProvider} = require('./openai')
const {
  STORY_OPTIONS_OPENAI_RESPONSE_FORMAT,
} = require('../storySchema')

function makeUnsupportedParameterError(param, message = '') {
  return {
    response: {
      status: 400,
      data: {
        error: {
          type: 'unsupported_parameter',
          code: 'unsupported_parameter',
          param,
          message:
            message ||
            `Unsupported parameter: '${param}' is not supported for this model.`,
        },
      },
    },
  }
}

describe('openai provider adapter', () => {
  test('falls back from max_tokens to max_completion_tokens', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockRejectedValueOnce(makeUnsupportedParameterError('max_tokens'))
        .mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  content: '{"answer":"left","confidence":0.91}',
                },
              },
            ],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 15,
              total_tokens: 135,
            },
          },
        }),
    }

    const result = await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      flip: {
        hash: 'flip-1',
        leftImage: 'data:image/png;base64,AAA',
        rightImage: 'data:image/png;base64,BBB',
      },
      prompt: 'test prompt',
      profile: {
        temperature: 0,
        maxOutputTokens: 100,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
    })

    expect(httpClient.post).toHaveBeenCalledTimes(2)
    expect(httpClient.post.mock.calls[0][1].max_tokens).toBe(100)
    expect(
      httpClient.post.mock.calls[0][1].max_completion_tokens
    ).toBeUndefined()
    expect(httpClient.post.mock.calls[1][1].max_tokens).toBeUndefined()
    expect(httpClient.post.mock.calls[1][1].max_completion_tokens).toBe(100)
    expect(result.rawText).toContain('"answer":"left"')
    expect(result.usage.totalTokens).toBe(135)
  })

  test('removes response_format and temperature when unsupported', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockRejectedValueOnce(makeUnsupportedParameterError('response_format'))
        .mockRejectedValueOnce(makeUnsupportedParameterError('temperature'))
        .mockRejectedValueOnce(makeUnsupportedParameterError('temperature'))
        .mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  content: '{"answer":"right","confidence":0.7}',
                },
              },
            ],
            usage: {
              prompt_tokens: 80,
              completion_tokens: 20,
              total_tokens: 100,
            },
          },
        }),
    }

    await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'o3',
      flip: {
        hash: 'flip-2',
        leftImage: 'data:image/png;base64,AAA',
        rightImage: 'data:image/png;base64,BBB',
      },
      prompt: 'test prompt',
      profile: {
        temperature: 0.2,
        maxOutputTokens: 128,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
    })

    expect(httpClient.post).toHaveBeenCalledTimes(4)
    expect(httpClient.post.mock.calls[2][1].response_format).toBeUndefined()
    expect(httpClient.post.mock.calls[2][1].temperature).toBe(0.2)
    expect(httpClient.post.mock.calls[3][1].response_format).toBeUndefined()
    expect(httpClient.post.mock.calls[3][1].temperature).toBeUndefined()
  })

  test('uses minimal payload for provider test call', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({data: {ok: true}}),
    }

    await testOpenAiProvider({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      profile: {
        requestTimeoutMs: 4000,
      },
      providerConfig: null,
    })

    const payload = httpClient.post.mock.calls[0][1]
    expect(payload.model).toBe('gpt-4.1-mini')
    expect(Array.isArray(payload.messages)).toBe(true)
    expect(payload.temperature).toBeUndefined()
    expect(payload.max_tokens).toBeUndefined()
    expect(payload.max_completion_tokens).toBeUndefined()
    expect(payload.response_format).toBeUndefined()
  })

  test('passes through structured output schema and exposes provider refusal metadata', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              finish_reason: 'content_filter',
              message: {
                content: '',
                refusal: 'Policy refusal.',
              },
            },
          ],
          usage: {
            prompt_tokens: 90,
            completion_tokens: 0,
            total_tokens: 90,
          },
        },
      }),
    }

    const result = await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      flip: {
        hash: 'flip-structured-output',
      },
      prompt: 'return structured story json',
      profile: {
        temperature: 0.2,
        maxOutputTokens: 256,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
      promptOptions: {
        structuredOutput: {
          responseFormat: STORY_OPTIONS_OPENAI_RESPONSE_FORMAT,
        },
      },
    })

    expect(httpClient.post).toHaveBeenCalledTimes(1)
    expect(httpClient.post.mock.calls[0][1].response_format).toEqual(
      STORY_OPTIONS_OPENAI_RESPONSE_FORMAT
    )
    expect(result.providerMeta).toMatchObject({
      finishReason: 'content_filter',
      refusal: 'Policy refusal.',
      safetyBlock: true,
      truncated: false,
    })
  })
})
