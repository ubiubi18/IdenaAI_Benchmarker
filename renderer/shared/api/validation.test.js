jest.mock('./api-client', () => ({
  __esModule: true,
  default: jest.fn(),
}))

const api = require('./api-client').default
const {fetchFlipHashes} = require('./validation')

describe('validation api', () => {
  beforeEach(() => {
    api.mockReset()
  })

  it('normalizes null flip-hash payloads to an empty list', async () => {
    const post = jest.fn(async () => ({
      data: {
        result: null,
      },
    }))

    api.mockReturnValue({post})

    await expect(fetchFlipHashes('short')).resolves.toEqual([])
    expect(post).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({
        method: 'flip_shortHashes',
      })
    )
  })

  it('keeps only valid hash entries from mixed payloads', async () => {
    api.mockReturnValue({
      post: jest.fn(async () => ({
        data: {
          result: [
            null,
            {hash: '  0xabc  ', ready: true, extra: false},
            {hash: '', ready: true},
            {foo: 'bar'},
          ],
        },
      })),
    })

    await expect(fetchFlipHashes('long')).resolves.toEqual([
      {hash: '0xabc', ready: true, extra: false},
    ])
  })
})
