import React from 'react'
import NextLink from 'next/link'
import {Box, Flex, HStack, Stack, Text} from '@chakra-ui/react'
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
const SOCIAL_CONTRACT_ADDRESS = '0xc0324f3Cf8158D6E27dc0A07c221636056174718'

function buildSocialNodeBootstrap(settings) {
  const nodeUrl = settings.useExternalNode
    ? settings.url || BASE_API_URL
    : `http://localhost:${settings.internalPort || BASE_INTERNAL_API_PORT}`

  const nodeApiKey = settings.useExternalNode
    ? settings.externalApiKey || ''
    : settings.internalApiKey || ''

  return {
    embeddedMode: 'desktop-onchain',
    nodeUrl,
    nodeApiKey,
    indexerApiUrl: '',
    sendingTxs: 'rpc',
    findingPastPosts: 'rpc',
  }
}

export default function SocialPage() {
  const settings = useSettingsState()
  const {offline, syncing} = useChainState()

  const [iframeNonce, setIframeNonce] = React.useState(0)
  const [bootstrapReady, setBootstrapReady] = React.useState(false)

  const bootstrap = React.useMemo(
    () => buildSocialNodeBootstrap(settings),
    [settings]
  )

  React.useEffect(() => {
    if (typeof window === 'undefined') return

    window.localStorage.setItem(
      SOCIAL_BOOTSTRAP_STORAGE_KEY,
      JSON.stringify(bootstrap)
    )
    setBootstrapReady(true)
  }, [bootstrap])

  return (
    <Layout>
      <Page px={0} py={0} overflow="hidden">
        <Box px={20} py={6}>
          <PageTitle mb={2}>Social</PageTitle>
          <Stack spacing={3} maxW="4xl">
            <Text color="muted">
              Local bundled `idena.social` UI running inside idena-desktop.
              Posts and reads default to your current node RPC settings, not to
              an external website or indexer API.
            </Text>
            <HStack spacing={4} flexWrap="wrap">
              <Text>
                Node: <strong>{bootstrap.nodeUrl}</strong>
              </Text>
              <Text>
                Sending: <strong>RPC only</strong>
              </Text>
              <Text>
                History scan: <strong>RPC only</strong>
              </Text>
            </HStack>
            <HStack spacing={3}>
              <SecondaryButton
                onClick={() => setIframeNonce((value) => value + 1)}
              >
                Reload social view
              </SecondaryButton>
              <NextLink href="/settings/node" passHref>
                <TextLink>Node settings</TextLink>
              </NextLink>
              <ExternalLink
                href={`https://scan.idena.io/contract/${SOCIAL_CONTRACT_ADDRESS}`}
              >
                Contract on scan.idena.io
              </ExternalLink>
            </HStack>
            {(offline || syncing) && (
              <Text color="orange.500">
                Your node is currently {offline ? 'offline' : 'syncing'}. The
                social view may stay read-only or temporarily unavailable until
                RPC becomes healthy.
              </Text>
            )}
          </Stack>
        </Box>

        <Flex flex={1} px={20} pb={6} minH="0">
          {bootstrapReady ? (
            <Box
              as="iframe"
              key={iframeNonce}
              src="/idena-social/index.html#/"
              title="idena.social"
              w="full"
              h="calc(100vh - 220px)"
              border="1px solid"
              borderColor="gray.100"
              borderRadius="lg"
              bg="white"
            />
          ) : (
            <Flex
              align="center"
              justify="center"
              w="full"
              h="calc(100vh - 220px)"
              border="1px solid"
              borderColor="gray.100"
              borderRadius="lg"
              bg="white"
            >
              <Text color="muted">Preparing local social view…</Text>
            </Flex>
          )}
        </Flex>
      </Page>
    </Layout>
  )
}
