import React from 'react'
import NextLink from 'next/link'
import {Box, Button, Flex, HStack, Stack, Text, Tooltip} from '@chakra-ui/react'
import Layout from '../shared/components/layout'
import {SecondaryButton} from '../shared/components/button'
import {
  ExternalLink,
  Page,
  PageTitle,
  TextLink,
} from '../shared/components/components'
import {useSettingsState} from '../shared/providers/settings-context'
import {useChainState} from '../shared/providers/chain-context'
import {BASE_API_URL, BASE_INTERNAL_API_PORT} from '../shared/api/api-client'

const SOCIAL_BOOTSTRAP_STORAGE_KEY = 'idenaSocialDesktopBootstrap'
const SOCIAL_HISTORY_MODE_STORAGE_KEY = 'idenaSocialDesktopHistoryModeV2'
const SOCIAL_BOOTSTRAP_MESSAGE_TYPE = 'IDENA_SOCIAL_BOOTSTRAP'
const SOCIAL_BOOTSTRAP_READY_MESSAGE_TYPE = 'IDENA_SOCIAL_READY'
const SOCIAL_RPC_REQUEST_MESSAGE_TYPE = 'IDENA_SOCIAL_RPC_REQUEST'
const SOCIAL_RPC_RESPONSE_MESSAGE_TYPE = 'IDENA_SOCIAL_RPC_RESPONSE'
const SOCIAL_CONTRACT_ADDRESS = '0xa1c5c1A8c6a1Af596078A5c9653F24c216fE1cb2'
const SOCIAL_OFFICIAL_INDEXER_URL = 'https://api.idena.io'
const SOCIAL_MAX_IMAGE_BYTES = 1024 * 1024
const SOCIAL_IMAGE_FORMATS = [
  'PNG',
  'JPEG',
  'GIF',
  'WebP',
  'AVIF',
  'APNG',
  'SVG',
]

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

function buildSocialNodeBootstrap(settings, historyMode) {
  const nodeUrl = settings.useExternalNode
    ? settings.url || BASE_API_URL
    : `http://127.0.0.1:${settings.internalPort || BASE_INTERNAL_API_PORT}`

  return {
    embeddedMode: 'desktop-onchain',
    nodeUrl,
    indexerApiUrl: SOCIAL_OFFICIAL_INDEXER_URL,
    sendingTxs: 'rpc',
    findingPastPosts: historyMode,
  }
}

export default function SocialPage() {
  const settings = useSettingsState()
  const {offline, syncing} = useChainState()
  const {externalApiKey, internalApiKey, internalPort, url, useExternalNode} =
    settings

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
          externalApiKey,
          internalApiKey,
          internalPort,
          url,
          useExternalNode,
        },
        historyMode === 'indexer-api' ? 'indexer-api' : 'rpc'
      ),
    [
      externalApiKey,
      historyMode,
      internalApiKey,
      internalPort,
      url,
      useExternalNode,
    ]
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

      const requestBody = {
        method,
        params: Array.isArray(params) ? params : [],
        id: 1,
        key: useExternalNode ? externalApiKey || '' : internalApiKey || '',
      }

      let responsePayload = {}

      try {
        const response = await fetch(bootstrap.nodeUrl, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
          throw new Error(`Response status: ${response.status}`)
        }

        responsePayload = await response.json()
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
  }, [bootstrap.nodeUrl, externalApiKey, internalApiKey, useExternalNode])

  React.useEffect(() => {
    if (postBootstrapToIframe()) {
      setBootstrapReady(true)
    }
  }, [postBootstrapToIframe])

  const usingIndexerFallback = historyMode === 'indexer-api'

  return (
    <Layout>
      <Page px={0} py={0} overflow="hidden" align="stretch">
        <Box px={8} py={6} w="full">
          <PageTitle mb={2}>Social</PageTitle>
          <Stack spacing={3} maxW="7xl">
            <Text color="muted">
              Local bundled `idena.social` UI inside idena-desktop. Posting
              always uses your own node RPC. Community history now defaults to
              the official Idena indexer as a read-only fallback because node
              RPC-only scanning is often too narrow for the full feed.
            </Text>
            <HStack spacing={6} flexWrap="wrap" align="flex-start">
              <HStack spacing={2}>
                <Text>
                  Node: <strong>{bootstrap.nodeUrl}</strong>
                </Text>
                <InfoHint label="This embedded social view uses your current idena-desktop node endpoint. RPC authentication stays in the parent desktop app and is proxied to the embedded view instead of being injected into the iframe." />
              </HStack>
              <HStack spacing={2}>
                <Text>
                  Sending: <strong>RPC only</strong>
                </Text>
                <InfoHint label="Posting, liking, tipping and image uploads use only your own node RPC. Picture bytes are first stored through your node IPFS path, then referenced on-chain by CID." />
              </HStack>
              <HStack spacing={2}>
                <Text>
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
                <Text>
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
                <Text>
                  Fees: <strong>live max-fee estimate in composer</strong>
                </Text>
                <InfoHint label="The composer inside the social view shows a conservative max-fee estimate from your own node RPC for the current draft. The final charged fee can be lower." />
              </HStack>
            </HStack>
            <HStack spacing={3} flexWrap="wrap">
              <SecondaryButton
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
              <NextLink href="/settings/node" passHref>
                <TextLink>Node settings</TextLink>
              </NextLink>
              <ExternalLink
                href={`https://scan.idena.io/contract/${SOCIAL_CONTRACT_ADDRESS}`}
              >
                Contract on scan.idena.io
              </ExternalLink>
            </HStack>
            <Text color="muted" fontSize="sm">
              {usingIndexerFallback
                ? `Community history is currently read from ${SOCIAL_OFFICIAL_INDEXER_URL}. Posting still stays on your own node RPC.`
                : 'RPC-only history is active. This mode may miss broader community posts even when your node is synced.'}
            </Text>
            {(offline || syncing) && (
              <Text color="orange.500">
                Your node is currently {offline ? 'offline' : 'syncing'}. The
                social view may stay read-only or temporarily unavailable until
                RPC becomes healthy.
              </Text>
            )}
          </Stack>
        </Box>

        <Flex flex={1} w="full" px={8} pb={6} minH="0">
          <Box position="relative" w="full" h="calc(100vh - 250px)">
            <Box
              as="iframe"
              ref={iframeRef}
              key={`${historyMode}:${iframeNonce}`}
              src="/idena-social/index.html#/"
              title="idena.social"
              w="full"
              h="full"
              border="1px solid"
              borderColor="gray.100"
              borderRadius="lg"
              bg="white"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-popups"
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
