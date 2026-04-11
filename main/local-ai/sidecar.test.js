const {createLocalAiSidecar} = require('./sidecar')

describe('local-ai sidecar', () => {
  it('checks health from the configured base URL', async () => {
    const httpClient = {
      get: jest.fn(async () => ({
        data: {ok: true, service: 'local-ai-sidecar-stub'},
      })),
    }
    const sidecar = createLocalAiSidecar({httpClient})

    await expect(
      sidecar.getHealth({baseUrl: 'http://localhost:5000'})
    ).resolves.toMatchObject({
      ok: true,
      reachable: true,
      endpoint: 'http://localhost:5000/health',
      data: {
        ok: true,
        service: 'local-ai-sidecar-stub',
      },
    })
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
      sidecar.getHealth({baseUrl: 'http://localhost:5000'})
    ).resolves.toMatchObject({
      ok: false,
      reachable: false,
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
      sidecar.listModels({baseUrl: 'http://localhost:5000'})
    ).resolves.toMatchObject({
      ok: true,
      reachable: true,
      endpoint: 'http://localhost:5000/models',
      models: ['local-stub-chat'],
      total: 1,
    })
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
      sidecar.captionFlip({baseUrl: 'http://localhost:5000', flipHash: 'flip-a'})
    ).resolves.toMatchObject({
      ok: false,
      status: 'not_implemented',
      endpoint: 'http://localhost:5000/caption',
    })
  })
})
