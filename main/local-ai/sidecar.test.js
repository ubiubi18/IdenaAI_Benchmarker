const {createLocalAiSidecar} = require('./sidecar')

function mockOllamaChatResponse(content, model = 'qwen3.5:9b') {
  return {
    data: {
      model,
      message: {
        role: 'assistant',
        content,
      },
    },
    config: {
      url: 'http://127.0.0.1:11434/api/chat',
    },
  }
}

describe('local-ai sidecar', () => {
  it('checks health from the configured base URL', async () => {
    const httpClient = {
      get: jest.fn(async () => ({
        data: {ok: true, service: 'local-ai-sidecar-stub'},
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.getHealth({
        runtimeType: 'sidecar',
        baseUrl: 'http://localhost:5000',
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'ok',
      reachable: true,
      runtime: 'idena-local-runtime',
      endpoint: 'http://localhost:5000/health',
      data: {
        ok: true,
        service: 'local-ai-sidecar-stub',
      },
    })

    expect(httpClient.get).toHaveBeenCalledWith(
      'http://localhost:5000/health',
      expect.objectContaining({
        timeout: 5000,
      })
    )
  })

  it('fails gracefully when the sidecar is absent', async () => {
    const httpClient = {
      get: jest.fn(async () => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:5000')
        error.code = 'ECONNREFUSED'
        throw error
      }),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.getHealth({
        runtimeType: 'sidecar',
        baseUrl: 'http://localhost:5000',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'error',
      reachable: false,
      runtime: 'idena-local-runtime',
      endpoint: 'http://localhost:5000/health',
      lastError: expect.stringContaining('ECONNREFUSED'),
    })
  })

  it('falls back from /v1/models to /models for local model listing', async () => {
    const notFound = new Error('missing')
    notFound.response = {status: 404}

    const httpClient = {
      get: jest
        .fn()
        .mockRejectedValueOnce(notFound)
        .mockResolvedValueOnce({
          data: {
            data: [{id: 'local-stub-chat'}],
          },
          config: {
            url: 'http://localhost:5000/models',
          },
        }),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.listModels({
        runtimeType: 'sidecar',
        baseUrl: 'http://localhost:5000',
      })
    ).resolves.toMatchObject({
      ok: true,
      reachable: true,
      endpoint: 'http://localhost:5000/models',
      models: ['local-stub-chat'],
      total: 1,
    })
  })

  it('adds the managed auth token to local runtime service requests', async () => {
    const httpClient = {
      get: jest
        .fn()
        .mockResolvedValueOnce({
          data: {ok: true, service: 'local-ai-sidecar-stub'},
        })
        .mockResolvedValueOnce({
          data: {
            data: [{id: 'allenai/Molmo2-O-7B'}],
          },
          config: {
            url: 'http://127.0.0.1:8080/v1/models',
          },
        }),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.getHealth({
        runtimeBackend: 'local-runtime-service',
        runtimeType: 'sidecar',
        baseUrl: 'http://127.0.0.1:8080',
        runtimeAuthToken: 'managed-token',
      })
    ).resolves.toMatchObject({
      ok: true,
      endpoint: 'http://127.0.0.1:8080/health',
    })

    await expect(
      sidecar.listModels({
        runtimeBackend: 'local-runtime-service',
        runtimeType: 'sidecar',
        baseUrl: 'http://127.0.0.1:8080',
        runtimeAuthToken: 'managed-token',
      })
    ).resolves.toMatchObject({
      ok: true,
      endpoint: 'http://127.0.0.1:8080/v1/models',
      models: ['allenai/Molmo2-O-7B'],
    })

    expect(httpClient.get).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8080/health',
      expect.objectContaining({
        headers: {'X-IdenaAI-Local-Token': 'managed-token'},
      })
    )
    expect(httpClient.get).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8080/v1/models',
      expect.objectContaining({
        headers: {'X-IdenaAI-Local-Token': 'managed-token'},
      })
    )
  })

  it('returns explicit not_implemented for optional sidecar endpoints', async () => {
    const notFound = new Error('missing')
    notFound.response = {status: 404}

    const httpClient = {
      post: jest.fn(async () => {
        throw notFound
      }),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.captionFlip({
        baseUrl: 'http://localhost:5000',
        flipHash: 'flip-a',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'not_implemented',
      endpoint: 'http://localhost:5000/caption',
    })
  })

  it('treats payload-level not_implemented as a failed local sidecar action', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          ok: false,
          status: 'not_implemented',
          detail: 'train is not implemented in the Local AI stub yet.',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.trainEpoch({
        baseUrl: 'http://localhost:5000',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'not_implemented',
      endpoint: 'http://localhost:5000/train',
      lastError: 'train is not implemented in the Local AI stub yet.',
    })
  })

  it('sanitizes training payloads before posting them to the local sidecar', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          ok: true,
          status: 'ok',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.trainEpoch({
        baseUrl: 'http://localhost:5000',
        timeoutMs: 999999,
        runtimeBackend: 'local-runtime-service',
        runtimeType: 'sidecar',
        developerHumanTeacherSystemPrompt: 'x'.repeat(9000),
        input: {
          developerHumanTeacher: true,
          sampleName: 'flip-sample',
          trainingModelPath: 'mlx-community/open-vision-7b-4bit',
          localTrainingProfile: 'invalid-profile',
          localTrainingThermalMode: 'lava',
          localTrainingEpochs: 99,
          localTrainingBatchSize: 0,
          localTrainingLoraRank: 999,
          evaluationFlips: 123,
          comparisonOnly: true,
          compareOnly: true,
          noisy: {
            nested: {
              value: 'kept but bounded',
            },
          },
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      endpoint: 'http://localhost:5000/train',
    })

    expect(httpClient.post).toHaveBeenCalledTimes(1)
    expect(httpClient.post).toHaveBeenCalledWith(
      'http://localhost:5000/train',
      expect.objectContaining({
        runtimeBackend: 'local-runtime-service',
        runtimeType: 'sidecar',
        developerHumanTeacherSystemPrompt: 'x'.repeat(8000),
        input: expect.objectContaining({
          developerHumanTeacher: true,
          sampleName: 'flip-sample',
          trainingModelPath: 'mlx-community/open-vision-7b-4bit',
          modelPath: 'mlx-community/open-vision-7b-4bit',
          localTrainingProfile: 'strong',
          localTrainingThermalMode: 'balanced',
          localTrainingEpochs: 6,
          localTrainingBatchSize: 1,
          localTrainingLoraRank: 16,
          evaluationFlips: 100,
          comparisonOnly: true,
          compareOnly: true,
        }),
      }),
      expect.objectContaining({
        timeout: 90 * 1000,
      })
    )

    const postedBody = httpClient.post.mock.calls[0][1]

    expect(postedBody.baseUrl).toBeUndefined()
    expect(postedBody.timeoutMs).toBeUndefined()
    expect(postedBody.input.noisy).toBeUndefined()
  })

  it('loads Ollama health from /api/version when runtimeType is ollama', async () => {
    const httpClient = {
      get: jest.fn(async () => ({
        data: {version: '0.7.0'},
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.getHealth({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'ok',
      reachable: true,
      runtime: 'ollama',
      runtimeType: 'ollama',
      endpoint: 'http://127.0.0.1:11434/api/version',
      data: {
        version: '0.7.0',
      },
    })
  })

  it('loads Ollama health from runtimeBackend without requiring runtimeType', async () => {
    const httpClient = {
      get: jest.fn(async () => ({
        data: {version: '0.7.0'},
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.getHealth({
        runtimeBackend: 'ollama-direct',
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'ok',
      reachable: true,
      runtime: 'ollama',
      runtimeBackend: 'ollama-direct',
      runtimeType: 'ollama',
      endpoint: 'http://127.0.0.1:11434/api/version',
    })
  })

  it('rejects non-loopback endpoints before contacting the Local AI runtime', async () => {
    const httpClient = {
      get: jest.fn(),
      post: jest.fn(),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.getHealth({
        runtimeType: 'ollama',
        baseUrl: 'https://example.com:11434',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'config_error',
      error: 'loopback_only',
      lastError:
        'Local AI endpoint must stay on this machine (localhost, 127.0.0.1, or ::1).',
    })

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'https://example.com:11434',
        model: 'llama3.1:8b',
        input: 'Hello',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'config_error',
      error: 'loopback_only',
      lastError:
        'Local AI endpoint must stay on this machine (localhost, 127.0.0.1, or ::1).',
    })

    expect(httpClient.get).not.toHaveBeenCalled()
    expect(httpClient.post).not.toHaveBeenCalled()
  })

  it('loads Ollama models from /api/tags when runtimeType is ollama', async () => {
    const httpClient = {
      get: jest.fn(async () => ({
        data: {
          models: [{name: 'llama3.1:8b'}],
        },
        config: {
          url: 'http://127.0.0.1:11434/api/tags',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.listModels({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
      })
    ).resolves.toMatchObject({
      ok: true,
      reachable: true,
      runtimeType: 'ollama',
      endpoint: 'http://127.0.0.1:11434/api/tags',
      models: ['llama3.1:8b'],
      total: 1,
    })
  })

  it('uses the default Ollama endpoint when chat omits baseUrl', async () => {
    const httpClient = {
      post: jest.fn(),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: '',
        model: 'llama3.1:8b',
        input: 'Hello',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'parse_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'invalid_response',
      baseUrl: 'http://127.0.0.1:11434',
      endpoint: 'http://127.0.0.1:11434/api/chat',
    })
    expect(httpClient.post).toHaveBeenCalledTimes(1)
  })

  it('passes a structured JSON schema response format through to Ollama chat', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          model: 'reasoner-lab:latest',
          message: {
            role: 'assistant',
            content: '{"final_answer":"left"}',
          },
        },
        config: {
          url: 'http://127.0.0.1:11434/api/chat',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})
    const responseFormat = {
      type: 'object',
      additionalProperties: false,
      required: ['final_answer'],
      properties: {
        final_answer: {
          type: 'string',
          enum: ['left', 'right', 'skip'],
        },
      },
    }

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'reasoner-lab:latest',
        input: 'Answer with JSON.',
        responseFormat,
      })
    ).resolves.toMatchObject({
      ok: true,
      text: '{"final_answer":"left"}',
    })

    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({
        model: 'reasoner-lab:latest',
        format: responseFormat,
      }),
      expect.any(Object)
    )
  })

  it('returns a structured config error when the Ollama model is missing', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          model: 'qwen3.5:9b',
          message: {
            role: 'assistant',
            content: 'Hello from the fixed runtime.',
          },
        },
        config: {
          url: 'http://127.0.0.1:11434/api/chat',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: '',
        input: 'Hello',
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'ok',
      provider: 'local-ai',
      runtimeType: 'ollama',
      model: 'qwen3.5:9b',
      content: 'Hello from the fixed runtime.',
    })
    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({
        model: 'qwen3.5:9b',
      }),
      expect.any(Object)
    )
  })

  it('rejects malformed Ollama model identifiers before sending a request', async () => {
    const httpClient = {
      post: jest.fn(),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b\nrm -rf /',
        input: 'Say hello.',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'config_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'model_invalid',
    })
    expect(httpClient.post).not.toHaveBeenCalled()
  })

  it('posts non-streaming Ollama chat and returns parsed assistant content', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          model: 'llama3.1:8b',
          message: {
            role: 'assistant',
            content: 'Hello from Ollama.',
          },
        },
        config: {
          url: 'http://127.0.0.1:11434/api/chat',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        input: 'Say hello.',
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'ok',
      provider: 'local-ai',
      runtimeType: 'ollama',
      model: 'llama3.1:8b',
      endpoint: 'http://127.0.0.1:11434/api/chat',
      content: 'Hello from Ollama.',
      lastError: null,
    })
    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      {
        model: 'llama3.1:8b',
        messages: [{role: 'user', content: 'Say hello.'}],
        stream: false,
      },
      expect.objectContaining({
        timeout: 15000,
      })
    )
  })

  it('posts chat to a local runtime service and preserves multimodal content', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          model: 'allenai/Molmo2-O-7B',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"final_answer":"left"}',
              },
            },
          ],
        },
        config: {
          url: 'http://127.0.0.1:8080/v1/chat/completions',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeBackend: 'local-runtime-service',
        runtimeType: 'sidecar',
        baseUrl: 'http://127.0.0.1:8080',
        runtimeAuthToken: 'managed-token',
        model: 'allenai/Molmo2-O-7B',
        visionModel: 'allenai/Molmo2-O-7B',
        responseFormat: {
          type: 'object',
          properties: {
            final_answer: {type: 'string'},
          },
        },
        messages: [
          {
            role: 'user',
            content: 'Describe this flip.',
            images: ['data:image/png;base64,QUJD'],
          },
        ],
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'ok',
      provider: 'local-ai',
      runtimeBackend: 'local-runtime-service',
      runtimeType: 'sidecar',
      model: 'allenai/Molmo2-O-7B',
      endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
      content: '{"final_answer":"left"}',
      lastError: null,
    })

    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/chat/completions',
      expect.objectContaining({
        model: 'allenai/Molmo2-O-7B',
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Describe this flip.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/png;base64,QUJD',
                },
              },
            ],
          },
        ],
      }),
      expect.objectContaining({
        headers: {'X-IdenaAI-Local-Token': 'managed-token'},
        timeout: 15000,
      })
    )

    const postedBody = httpClient.post.mock.calls[0][1]
    expect(postedBody.response_format).toBeUndefined()
  })

  it('disables Ollama thinking for deepseek local chat requests', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          model: 'deepseek-r1:8b',
          message: {
            role: 'assistant',
            content: 'Fast local chat.',
          },
        },
        config: {
          url: 'http://127.0.0.1:11434/api/chat',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'deepseek-r1:8b',
        input: 'Say hello.',
      })
    ).resolves.toMatchObject({
      ok: true,
      model: 'deepseek-r1:8b',
      text: 'Fast local chat.',
    })

    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({
        model: 'deepseek-r1:8b',
        think: false,
      }),
      expect.objectContaining({
        timeout: 15000,
      })
    )
  })

  it('accepts alternate Ollama response shapes for assistant text', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            model: 'llama3.1:8b',
            response: 'Hello from response.',
          },
          config: {
            url: 'http://127.0.0.1:11434/api/chat',
          },
        })
        .mockResolvedValueOnce({
          data: {
            model: 'llama3.1:8b',
            message: {
              role: 'assistant',
              content: [{text: 'Hello'}, {text: 'from array.'}],
            },
          },
          config: {
            url: 'http://127.0.0.1:11434/api/chat',
          },
        })
        .mockResolvedValueOnce({
          data: {
            model: 'llama3.1:8b',
            choices: [{text: 'Hello from choices text.'}],
          },
          config: {
            url: 'http://127.0.0.1:11434/api/chat',
          },
        })
        .mockResolvedValueOnce({
          data: {
            model: 'llama3.1:8b',
            choices: [
              {
                delta: {
                  content: [{text: 'Hello'}, {text: 'from delta array.'}],
                },
              },
            ],
          },
          config: {
            url: 'http://127.0.0.1:11434/api/chat',
          },
        }),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        input: 'Say hello.',
      })
    ).resolves.toMatchObject({
      ok: true,
      text: 'Hello from response.',
      content: 'Hello from response.',
    })

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        input: 'Say hello again.',
      })
    ).resolves.toMatchObject({
      ok: true,
      text: 'Hello\nfrom array.',
      content: 'Hello\nfrom array.',
    })

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        input: 'Say hello a third time.',
      })
    ).resolves.toMatchObject({
      ok: true,
      text: 'Hello from choices text.',
      content: 'Hello from choices text.',
    })

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        input: 'Say hello a fourth time.',
      })
    ).resolves.toMatchObject({
      ok: true,
      text: 'Hello\nfrom delta array.',
      content: 'Hello\nfrom delta array.',
    })
  })

  it('allows up to 10000 characters for one chat message', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          model: 'llama3.1:8b',
          message: {
            role: 'assistant',
            content: 'Long input accepted.',
          },
        },
        config: {
          url: 'http://127.0.0.1:11434/api/chat',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})
    const nearLimit = 'A'.repeat(10000)

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        input: nearLimit,
      })
    ).resolves.toMatchObject({
      ok: true,
      text: 'Long input accepted.',
    })

    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({
        messages: [{role: 'user', content: nearLimit}],
      }),
      expect.any(Object)
    )
  })

  it('rejects chat input above 10000 characters', async () => {
    const httpClient = {
      post: jest.fn(),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        input: 'A'.repeat(10001),
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'validation_error',
      error: 'message_too_large',
      lastError: 'Local AI chat accepts at most 10000 characters per message.',
    })

    expect(httpClient.post).not.toHaveBeenCalled()
  })

  it('rejects chat requests above 80000 total characters', async () => {
    const httpClient = {
      post: jest.fn(),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        messages: Array.from({length: 9}, (_, index) => ({
          role: 'user',
          content: `${index}:${'A'.repeat(9997)}`,
        })),
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'validation_error',
      error: 'conversation_too_large',
      lastError: 'Local AI chat accepts at most 80000 characters per request.',
    })

    expect(httpClient.post).not.toHaveBeenCalled()
  })

  it('allows longer image-chat timeouts up to the extended cap', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          model: 'reasoner-lab:latest',
          message: {
            role: 'assistant',
            content: 'Image answer.',
          },
        },
        config: {
          url: 'http://127.0.0.1:11434/api/chat',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        visionModel: 'reasoner-lab:latest',
        timeoutMs: 120000,
        messages: [
          {
            role: 'user',
            content: 'Describe the attached image.',
            images: ['data:image/png;base64,AAA='],
          },
        ],
      })
    ).resolves.toMatchObject({
      ok: true,
      text: 'Image answer.',
    })

    expect(httpClient.post).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({
        model: 'reasoner-lab:latest',
      }),
      expect.objectContaining({
        timeout: 90000,
      })
    )
  })

  it('returns a structured unavailable error when Ollama cannot be reached', async () => {
    const httpClient = {
      post: jest.fn(async () => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:11434')
        error.code = 'ECONNREFUSED'
        throw error
      }),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        input: 'Say hello.',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'unavailable',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'unavailable',
      lastError: expect.stringContaining('ECONNREFUSED'),
    })
  })

  it('adds an install hint when the requested Ollama model is missing locally', async () => {
    const httpClient = {
      post: jest.fn(async () => {
        const error = new Error(
          'model "reasoner-lab:latest" not found, try pulling it first'
        )
        error.response = {
          status: 404,
          data: {
            error: {
              message:
                'model "reasoner-lab:latest" not found, try pulling it first',
            },
          },
        }
        throw error
      }),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        visionModel: 'reasoner-lab:latest',
        messages: [
          {
            role: 'user',
            content: 'Describe the attached image.',
            images: ['data:image/png;base64,AAA='],
          },
        ],
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'unavailable',
      lastError: expect.stringContaining('ollama pull reasoner-lab:latest'),
    })
  })

  it('returns a structured parse error for malformed Ollama chat responses', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          model: 'llama3.1:8b',
          message: {},
        },
        config: {
          url: 'http://127.0.0.1:11434/api/chat',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.chat({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        input: 'Say hello.',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'parse_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'invalid_response',
      endpoint: 'http://127.0.0.1:11434/api/chat',
    })
  })

  it('runs ordered panel captions then sequence reduction for flipToText', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce(
          mockOllamaChatResponse('A person holds a cup.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse('The cup falls to the floor.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            'A cup drops from someone’s hand and hits the floor.',
            'llama3.1:8b'
          )
        ),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.flipToText({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'ok',
      provider: 'local-ai',
      runtimeType: 'ollama',
      model: 'llama3.1:8b',
      visionModel: 'moondream',
      text: 'A cup drops from someone’s hand and hits the floor.',
      endpoint: 'http://127.0.0.1:11434/api/chat',
    })

    expect(httpClient.post).toHaveBeenCalledTimes(3)
    expect(httpClient.post.mock.calls[0][1]).toMatchObject({
      model: 'moondream',
      messages: [
        expect.objectContaining({role: 'system'}),
        expect.objectContaining({role: 'user', images: ['AAA=']}),
      ],
      stream: false,
    })
    expect(httpClient.post.mock.calls[1][1]).toMatchObject({
      model: 'moondream',
      messages: [
        expect.objectContaining({role: 'system'}),
        expect.objectContaining({role: 'user', images: ['BBB=']}),
      ],
      stream: false,
    })
    expect(httpClient.post.mock.calls[2][1]).toMatchObject({
      model: 'llama3.1:8b',
      stream: false,
    })
  })

  it('rejects oversized image payloads before contacting Ollama', async () => {
    const httpClient = {
      post: jest.fn(),
    }
    const sidecar = createLocalAiSidecar({httpClient})
    const oversizedBase64 = `data:image/png;base64,${'A'.repeat(
      8 * 1024 * 1024
    )}`

    await expect(
      sidecar.flipToText({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream:latest',
        model: 'llama3.1:8b',
        input: {
          images: [oversizedBase64],
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'validation_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'image_too_large',
    })

    expect(httpClient.post).not.toHaveBeenCalled()
  })

  it('preserves panel order and does not leak raw-image fields into reduction prompts', async () => {
    const logger = {
      debug: jest.fn(),
      error: jest.fn(),
    }
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce(
          mockOllamaChatResponse('A child opens a door.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse('A child walks into the room.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            'A child opens a door and enters the room.',
            'llama3.1:8b'
          )
        ),
    }
    const sidecar = createLocalAiSidecar({httpClient, logger})

    await expect(
      sidecar.flipToText({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          title: 'Bridge story',
          panels: [
            {imageDataUrl: 'data:image/png;base64,LEFT='},
            {imageDataUrl: 'data:image/png;base64,RIGHT='},
          ],
          rawImage: 'AAAABBBB',
          rawImages: ['CCC', 'DDD'],
          nested: {
            blob: 'CCC',
          },
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'ok',
      model: 'llama3.1:8b',
      visionModel: 'moondream',
      text: 'A child opens a door and enters the room.',
    })

    const reductionBody = httpClient.post.mock.calls[2][1]
    const serializedPrompt = JSON.stringify(reductionBody.messages)

    expect(httpClient.post.mock.calls[0][1].messages[1].images).toEqual([
      'LEFT=',
    ])
    expect(httpClient.post.mock.calls[1][1].messages[1].images).toEqual([
      'RIGHT=',
    ])
    expect(reductionBody.messages[1].content).toContain(
      'Panel 1: A child opens a door.'
    )
    expect(reductionBody.messages[1].content).toContain(
      'Panel 2: A child walks into the room.'
    )
    expect(serializedPrompt).not.toContain('rawImage')
    expect(serializedPrompt).not.toContain('AAAABBBB')
    expect(serializedPrompt).not.toContain('data:image/png')
    expect(serializedPrompt).not.toContain('nested')
    expect(logger.debug).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('returns a structured config error when the Ollama vision model is missing', async () => {
    const httpClient = {
      post: jest.fn(),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.flipToText({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: '',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA='],
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'config_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'vision_model_required',
    })
    expect(httpClient.post).not.toHaveBeenCalled()
  })

  it('returns a structured config error when the text reducer model is missing for flipToText', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce(
          mockOllamaChatResponse('A person holds a cup.', 'moondream')
        ),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.flipToText({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: '',
        input: {
          images: ['data:image/png;base64,AAA='],
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'config_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'model_required',
    })
    expect(httpClient.post).toHaveBeenCalledTimes(1)
  })

  it('uses the default Ollama endpoint when flipToText omits baseUrl', async () => {
    const httpClient = {
      post: jest.fn(),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.flipToText({
        runtimeType: 'ollama',
        baseUrl: '',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA='],
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'parse_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'invalid_response',
      baseUrl: 'http://127.0.0.1:11434',
      endpoint: 'http://127.0.0.1:11434/api/chat',
    })
    expect(httpClient.post).toHaveBeenCalledTimes(1)
  })

  it('returns a validation error when flipToText input has no usable images', async () => {
    const httpClient = {
      post: jest.fn(),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.flipToText({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          rawImage: 'AAAABBBB',
          rawImages: ['data:image/png;base64,AAA='],
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'validation_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'image_required',
    })
    expect(httpClient.post).not.toHaveBeenCalled()
  })

  it('returns a structured unavailable error when flipToText cannot reach Ollama during captioning', async () => {
    const httpClient = {
      post: jest.fn(async () => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:11434')
        error.code = 'ECONNREFUSED'
        throw error
      }),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.flipToText({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA='],
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'unavailable',
      provider: 'local-ai',
      runtimeType: 'ollama',
      visionModel: 'moondream',
      error: 'unavailable',
      lastError: expect.stringContaining('ECONNREFUSED'),
    })
    expect(httpClient.post).toHaveBeenCalledTimes(1)
  })

  it('returns a structured parse error for malformed panel caption responses', async () => {
    const httpClient = {
      post: jest.fn(async () => ({
        data: {
          model: 'moondream',
          message: {},
        },
        config: {
          url: 'http://127.0.0.1:11434/api/chat',
        },
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.flipToText({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA='],
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'parse_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      visionModel: 'moondream',
      error: 'invalid_response',
      endpoint: 'http://127.0.0.1:11434/api/chat',
    })
  })

  it('returns a structured parse error for malformed sequence reducer responses', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce(
          mockOllamaChatResponse('A person holds a cup.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse('The cup falls to the floor.', 'moondream')
        )
        .mockResolvedValueOnce({
          data: {
            model: 'llama3.1:8b',
            message: {},
          },
          config: {
            url: 'http://127.0.0.1:11434/api/chat',
          },
        }),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.flipToText({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'parse_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      visionModel: 'moondream',
      error: 'invalid_response',
      endpoint: 'http://127.0.0.1:11434/api/chat',
    })
  })

  it('runs the advisory checker pipeline in order and parses a consistent classification', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce(
          mockOllamaChatResponse('A child picks up a ball.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse('The child throws the ball.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            'A child picks up a ball and then throws it.',
            'llama3.1:8b'
          )
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            '{"classification":"consistent","confidence":"high","reason":"The action progresses clearly from one panel to the next."}',
            'llama3.1:8b'
          )
        ),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.checkFlipSequence({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      status: 'ok',
      provider: 'local-ai',
      runtimeType: 'ollama',
      visionModel: 'moondream',
      model: 'llama3.1:8b',
      classification: 'consistent',
      confidence: 'high',
      reason: 'The action progresses clearly from one panel to the next.',
      sequenceText: 'A child picks up a ball and then throws it.',
    })

    expect(httpClient.post).toHaveBeenCalledTimes(4)
    expect(httpClient.post.mock.calls[0][1].messages[1].images).toEqual([
      'AAA=',
    ])
    expect(httpClient.post.mock.calls[1][1].messages[1].images).toEqual([
      'BBB=',
    ])
    expect(httpClient.post.mock.calls[2][1].messages[1].content).toContain(
      'Panel 1: A child picks up a ball.'
    )
    expect(httpClient.post.mock.calls[2][1].messages[1].content).toContain(
      'Panel 2: The child throws the ball.'
    )
    expect(httpClient.post.mock.calls[3][1].messages[1].content).toContain(
      'Sequence summary:\nA child picks up a ball and then throws it.'
    )
  })

  it('parses an ambiguous checker classification', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce(
          mockOllamaChatResponse('A person stands near a door.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            'The person is still near the door.',
            'moondream'
          )
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            'A person remains near a door with little visible change.',
            'llama3.1:8b'
          )
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            '{"classification":"ambiguous","confidence":"medium","reason":"The panels show too little visible change to judge order reliably."}',
            'llama3.1:8b'
          )
        ),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.checkFlipSequence({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      classification: 'ambiguous',
      confidence: 'medium',
    })
  })

  it('parses an inconsistent checker classification', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce(
          mockOllamaChatResponse('A glass is full on a table.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            'The same glass is suddenly empty again.',
            'moondream'
          )
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            'A full glass abruptly appears empty with no visible transition.',
            'llama3.1:8b'
          )
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            '{"classification":"inconsistent","confidence":"high","reason":"The visible state change lacks a plausible transition between panels."}',
            'llama3.1:8b'
          )
        ),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.checkFlipSequence({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      classification: 'inconsistent',
      confidence: 'high',
    })
  })

  it('returns a structured parse error for malformed checker output', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce(
          mockOllamaChatResponse('A child picks up a ball.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse('The child throws the ball.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            'A child picks up a ball and then throws it.',
            'llama3.1:8b'
          )
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse('not valid json', 'llama3.1:8b')
        ),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.checkFlipSequence({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'parse_error',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'invalid_checker_response',
      classification: null,
      confidence: null,
    })
  })

  it('returns a structured unavailable error when the checker request cannot reach Ollama', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockResolvedValueOnce(
          mockOllamaChatResponse('A child picks up a ball.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse('The child throws the ball.', 'moondream')
        )
        .mockResolvedValueOnce(
          mockOllamaChatResponse(
            'A child picks up a ball and then throws it.',
            'llama3.1:8b'
          )
        )
        .mockRejectedValueOnce(
          Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
            code: 'ECONNREFUSED',
          })
        ),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.checkFlipSequence({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'unavailable',
      provider: 'local-ai',
      runtimeType: 'ollama',
      error: 'unavailable',
      classification: null,
      confidence: null,
    })
  })
})
