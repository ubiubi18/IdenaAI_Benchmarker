/* eslint-disable react/prop-types */
import React from 'react'
import {Box, Button, Flex, HStack, Stack, Text, Tooltip} from '@chakra-ui/react'
import Layout from './layout'
import {SecondaryButton} from './button'
import {ExternalLink, Page, PageTitle, TextLink} from './components'
import {useSettingsState} from '../providers/settings-context'
import {useChainState} from '../providers/chain-context'
import {BASE_API_URL, BASE_INTERNAL_API_PORT} from '../api/api-client'

const SOCIAL_BOOTSTRAP_STORAGE_KEY = 'idenaSocialDesktopBootstrap'
const SOCIAL_HISTORY_MODE_STORAGE_KEY = 'idenaSocialDesktopHistoryModeV2'
const SOCIAL_BOOTSTRAP_MESSAGE_TYPE = 'IDENA_SOCIAL_BOOTSTRAP'
const SOCIAL_BOOTSTRAP_READY_MESSAGE_TYPE = 'IDENA_SOCIAL_READY'
const SOCIAL_RPC_REQUEST_MESSAGE_TYPE = 'IDENA_SOCIAL_RPC_REQUEST'
const SOCIAL_RPC_RESPONSE_MESSAGE_TYPE = 'IDENA_SOCIAL_RPC_RESPONSE'
const SOCIAL_RPC_MAX_REQUEST_ID_LENGTH = 128
const SOCIAL_RPC_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
export const SOCIAL_CONTRACT_ADDRESS =
  '0xa1c5c1A8c6a1Af596078A5c9653F24c216fE1cb2'
export const SOCIAL_OFFICIAL_INDEXER_URL = 'https://api.idena.io'
export const SOCIAL_MAX_IMAGE_BYTES = 1024 * 1024
export const SOCIAL_IMAGE_FORMATS = [
  'PNG',
  'JPEG',
  'GIF',
  'WebP',
  'AVIF',
  'APNG',
  'SVG',
]
const SOCIAL_ALLOWED_RPC_METHODS = new Set([
  'bcn_block',
  'bcn_blockAt',
  'bcn_getRawTx',
  'bcn_lastBlock',
  'bcn_syncing',
  'bcn_transaction',
  'bcn_txReceipt',
  'contract_call',
  'dna_epoch',
  'dna_getBalance',
  'dna_getCoinbaseAddr',
  'dna_identity',
  'dna_storeToIpfs',
  'ipfs_add',
  'ipfs_get',
])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function isShortString(value, maxLength = 512) {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maxLength
  )
}

function estimatePayloadBytes(value) {
  try {
    const serialized = JSON.stringify(value)

    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(serialized).length
    }

    return serialized.length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function validateSocialRpcRequest(requestId, method, params) {
  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > SOCIAL_RPC_MAX_REQUEST_ID_LENGTH
  ) {
    return 'invalid_rpc_request_id'
  }

  if (!SOCIAL_ALLOWED_RPC_METHODS.has(method)) {
    return 'unsupported_rpc_method'
  }

  if (!Array.isArray(params)) {
    return 'invalid_rpc_params'
  }

  if (estimatePayloadBytes(params) > SOCIAL_RPC_MAX_PAYLOAD_BYTES) {
    return 'rpc_payload_too_large'
  }

  switch (method) {
    case 'bcn_syncing':
    case 'bcn_lastBlock':
    case 'dna_epoch':
    case 'dna_getCoinbaseAddr':
      return params.length === 0 ? null : 'invalid_rpc_params'

    case 'bcn_blockAt':
      return params.length === 1 && isFiniteNonNegativeInteger(params[0])
        ? null
        : 'invalid_rpc_params'

    case 'bcn_block':
    case 'bcn_transaction':
    case 'bcn_txReceipt':
    case 'dna_getBalance':
    case 'dna_identity':
    case 'ipfs_get':
      return params.length === 1 && isShortString(params[0], 256)
        ? null
        : 'invalid_rpc_params'

    case 'ipfs_add':
      return params.length === 2 &&
        isShortString(params[0], SOCIAL_RPC_MAX_PAYLOAD_BYTES) &&
        typeof params[1] === 'boolean'
        ? null
        : 'invalid_rpc_params'

    case 'dna_storeToIpfs':
      return params.length === 1 &&
        isPlainObject(params[0]) &&
        isShortString(params[0].cid, 256) &&
        isFiniteNonNegativeInteger(params[0].nonce) &&
        isFiniteNonNegativeInteger(params[0].epoch)
        ? null
        : 'invalid_rpc_params'

    case 'bcn_getRawTx':
      return params.length === 1 && isPlainObject(params[0])
        ? null
        : 'invalid_rpc_params'

    case 'contract_call':
      return params.length === 1 &&
        isPlainObject(params[0]) &&
        isShortString(params[0].from, 128) &&
        isShortString(params[0].contract, 128) &&
        isShortString(params[0].method, 128) &&
        Array.isArray(params[0].args)
        ? null
        : 'invalid_rpc_params'

    default:
      return 'unsupported_rpc_method'
  }
}

function formatBytesAsMib(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

// eslint-disable-next-line react/prop-types
function InfoHint({label}) {
  return (
    <Tooltip
      label={label}
      hasArrow
      placement="top"
      openDelay={150}
      maxW="sm"
      px={3}
      py={2}
      fontSize="sm"
    >
      <Box
        as="span"
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        w="18px"
        h="18px"
        borderRadius="full"
        borderWidth="1px"
        borderColor="gray.300"
        color="gray.500"
        fontSize="11px"
        fontWeight={700}
        cursor="help"
      >
        i
      </Box>
    </Tooltip>
  )
}

export function buildSocialNodeBootstrap(
  settings,
  historyMode,
  overrides = {}
) {
  const nodeUrl = settings.useExternalNode
    ? settings.url || BASE_API_URL
    : `http://127.0.0.1:${settings.internalPort || BASE_INTERNAL_API_PORT}`

  return {
    embeddedMode: 'desktop-onchain',
    nodeUrl,
    indexerApiUrl: SOCIAL_OFFICIAL_INDEXER_URL,
    sendingTxs: 'rpc',
    findingPastPosts: historyMode,
    ...overrides,
  }
}

export default function SocialDesktopEmbed({
  title = 'idena.social',
  description,
  headerContent = null,
  footerContent = null,
  bootstrapOverrides = null,
  iframeTitle = 'idena.social',
}) {
  const settings = useSettingsState()
  const {offline, syncing} = useChainState()
  const {internalPort, url, useExternalNode} = settings

  const [iframeNonce, setIframeNonce] = React.useState(0)
  const [bootstrapReady, setBootstrapReady] = React.useState(false)
  const [historyMode, setHistoryMode] = React.useState('indexer-api')
  const iframeRef = React.useRef(null)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(SOCIAL_BOOTSTRAP_STORAGE_KEY)
    const savedMode = window.localStorage.getItem(
      SOCIAL_HISTORY_MODE_STORAGE_KEY
    )
    if (savedMode === 'rpc' || savedMode === 'indexer-api') {
      setHistoryMode(savedMode)
    }
  }, [])

  const bootstrap = React.useMemo(
    () =>
      buildSocialNodeBootstrap(
        {
          internalPort,
          url,
          useExternalNode,
        },
        historyMode === 'indexer-api' ? 'indexer-api' : 'rpc',
        bootstrapOverrides || {}
      ),
    [bootstrapOverrides, historyMode, internalPort, url, useExternalNode]
  )

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SOCIAL_HISTORY_MODE_STORAGE_KEY, historyMode)
  }, [historyMode])

  const postBootstrapToIframe = React.useCallback(() => {
    const frameWindow = iframeRef.current?.contentWindow

    if (!frameWindow) {
      return false
    }

    frameWindow.postMessage(
      {
        type: SOCIAL_BOOTSTRAP_MESSAGE_TYPE,
        payload: bootstrap,
      },
      '*'
    )

    return true
  }, [bootstrap])

  React.useEffect(() => {
    if (typeof window === 'undefined') return

    setBootstrapReady(false)

    const handleMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }

      if (event.data?.type !== SOCIAL_BOOTSTRAP_READY_MESSAGE_TYPE) {
        return
      }

      if (postBootstrapToIframe()) {
        setBootstrapReady(true)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [postBootstrapToIframe, iframeNonce])

  React.useEffect(() => {
    if (typeof window === 'undefined') return

    const handleRpcRequest = async (event) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }

      const nextPayload =
        event.data && typeof event.data === 'object' ? event.data : null

      if (nextPayload?.type !== SOCIAL_RPC_REQUEST_MESSAGE_TYPE) {
        return
      }

      const {requestId, method, params} =
        nextPayload.payload && typeof nextPayload.payload === 'object'
          ? nextPayload.payload
          : {}

      if (typeof requestId !== 'string' || typeof method !== 'string') {
        return
      }

      const validationError = validateSocialRpcRequest(
        requestId,
        method,
        params
      )

      if (validationError) {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: SOCIAL_RPC_RESPONSE_MESSAGE_TYPE,
            payload: {
              requestId,
              response: {
                error: {
                  message: validationError,
                },
              },
            },
          },
          '*'
        )
        return
      }

      let responsePayload = {}

      try {
        const socialBridge =
          window.idena &&
          window.idena.social &&
          typeof window.idena.social.rpc === 'function'
            ? window.idena.social
            : null

        if (!socialBridge) {
          throw new Error('social_rpc_bridge_unavailable')
        }

        responsePayload = await socialBridge.rpc({
          requestId,
          method,
          params: Array.isArray(params) ? params : [],
        })
      } catch (error) {
        responsePayload = {
          error: {
            message: error?.message || 'social_rpc_proxy_failed',
          },
        }
      }

      iframeRef.current?.contentWindow?.postMessage(
        {
          type: SOCIAL_RPC_RESPONSE_MESSAGE_TYPE,
          payload: {
            requestId,
            response: responsePayload,
          },
        },
        '*'
      )
    }

    window.addEventListener('message', handleRpcRequest)
    return () => window.removeEventListener('message', handleRpcRequest)
  }, [])

  React.useEffect(() => {
    if (postBootstrapToIframe()) {
      setBootstrapReady(true)
    }
  }, [postBootstrapToIframe])

  const usingIndexerFallback = historyMode === 'indexer-api'
  const socialViewportHeight = 'calc(100vh - 220px)'

  return (
    <Layout>
      <Page px={0} py={0} overflow="hidden" align="stretch">
        <Box px={8} pt={4} pb={3} w="full">
          <PageTitle mb={1}>{title}</PageTitle>
          <Stack spacing={2} maxW="7xl">
            {description ? (
              <Text color="muted" fontSize="sm" lineHeight="tall">
                {description}
              </Text>
            ) : null}
            {headerContent}
            <HStack spacing={4} flexWrap="wrap" align="flex-start">
              <HStack spacing={2}>
                <Text fontSize="sm" lineHeight="short">
                  Node: <strong>{bootstrap.nodeUrl}</strong>
                </Text>
                <InfoHint label="This embedded social view uses your current idena-desktop node endpoint. RPC authentication stays in the parent desktop app and is proxied to the embedded view instead of being injected into the iframe." />
              </HStack>
              <HStack spacing={2}>
                <Text fontSize="sm" lineHeight="short">
                  Sending: <strong>RPC only</strong>
                </Text>
                <InfoHint label="Posting, liking, tipping and image uploads use only your own node RPC. Picture bytes are first stored through your node IPFS path, then referenced on-chain by CID." />
              </HStack>
              <HStack spacing={2}>
                <Text fontSize="sm" lineHeight="short">
                  History scan:{' '}
                  <strong>
                    {usingIndexerFallback
                      ? 'official indexer fallback (recommended)'
                      : 'RPC only'}
                  </strong>
                </Text>
                <InfoHint
                  label={
                    usingIndexerFallback
                      ? `Older posts are currently loaded from the official Idena indexer at ${SOCIAL_OFFICIAL_INDEXER_URL}. This is read-only fallback for history lookup. Posting still goes through your own node RPC.`
                      : 'Older posts are currently searched only through your own node RPC. Some nodes do not expose deep post history reliably or quickly.'
                  }
                />
              </HStack>
              <HStack spacing={2}>
                <Text fontSize="sm" lineHeight="short">
                  Image posts:{' '}
                  <strong>
                    {formatBytesAsMib(SOCIAL_MAX_IMAGE_BYTES)} max
                  </strong>
                </Text>
                <InfoHint
                  label={`Supported formats: ${SOCIAL_IMAGE_FORMATS.join(
                    ', '
                  )}. An image post adds one dna_storeToIpfs transaction for the file plus one contract_call for the message. Text above 100 characters adds another IPFS storage transaction.`}
                />
              </HStack>
              <HStack spacing={2}>
                <Text fontSize="sm" lineHeight="short">
                  Fees: <strong>live max-fee estimate in composer</strong>
                </Text>
                <InfoHint label="The composer inside the social view shows a conservative max-fee estimate from your own node RPC for the current draft. The final charged fee can be lower." />
              </HStack>
            </HStack>
            <HStack spacing={3} flexWrap="wrap">
              <SecondaryButton
                size="sm"
                onClick={() => setIframeNonce((value) => value + 1)}
              >
                Reload social view
              </SecondaryButton>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setHistoryMode((currentMode) =>
                    currentMode === 'rpc' ? 'indexer-api' : 'rpc'
                  )
                  setIframeNonce((value) => value + 1)
                }}
              >
                {usingIndexerFallback
                  ? 'Use node RPC-only history'
                  : 'Use official indexer for community history'}
              </Button>
              <TextLink href="/settings/node" fontSize="sm">
                Node settings
              </TextLink>
              <ExternalLink
                fontSize="sm"
                href={`https://scan.idena.io/contract/${SOCIAL_CONTRACT_ADDRESS}`}
              >
                Contract on scan.idena.io
              </ExternalLink>
            </HStack>
            <Text color="muted" fontSize="xs" lineHeight="tall">
              {usingIndexerFallback
                ? `Community history is currently read from ${SOCIAL_OFFICIAL_INDEXER_URL}. Posting still stays on your own node RPC.`
                : 'RPC-only history is active. This mode may miss broader community posts even when your node is synced.'}
            </Text>
            {footerContent}
            {(offline || syncing) && (
              <Text color="orange.500" fontSize="sm" lineHeight="tall">
                Your node is currently {offline ? 'offline' : 'syncing'}. The
                social view may stay read-only or temporarily unavailable until
                RPC becomes healthy.
              </Text>
            )}
          </Stack>
        </Box>

        <Flex flex={1} w="full" px={8} pb={6} minH="0">
          <Box position="relative" w="full" h={socialViewportHeight}>
            <Box
              as="iframe"
              ref={iframeRef}
              key={`${historyMode}:${iframeNonce}`}
              src="/idena-social/index.html#/"
              title={iframeTitle}
              w="full"
              h="full"
              border="1px solid"
              borderColor="gray.100"
              borderRadius="lg"
              bg="white"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-popups"
              onLoad={() => {
                if (postBootstrapToIframe()) {
                  setBootstrapReady(true)
                }
              }}
            />
            {!bootstrapReady && (
              <Flex
                position="absolute"
                inset={0}
                align="center"
                justify="center"
                borderRadius="lg"
                bg="whiteAlpha.900"
                pointerEvents="none"
              >
                <Text color="muted">Preparing local social view…</Text>
              </Flex>
            )}
          </Box>
        </Flex>
      </Page>
    </Layout>
  )
}
