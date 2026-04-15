import React from 'react'
import {Badge, Box, HStack, Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {useIdentityState} from '../shared/providers/identity-context'
import SocialDesktopEmbed, {
  SOCIAL_CONTRACT_ADDRESS,
} from '../shared/components/social-desktop-embed'
import {ExternalLink, TextLink} from '../shared/components/components'

const DAO_PROPOSAL_TAG = '#IdenaDAO'

const DAO_PROPOSAL_TEMPLATE = `${DAO_PROPOSAL_TAG} Proposal

Title:
Summary:
Motivation:
Proposal:
Requested decision:
Implementation notes:
`

function shortAddress(address) {
  if (!address || typeof address !== 'string') {
    return 'unknown identity'
  }

  return `${address.slice(0, 8)}...${address.slice(-6)}`
}

export default function DaoPage() {
  const {t} = useTranslation()
  const {address, isValidated, state} = useIdentityState()

  const bootstrapOverrides = React.useMemo(
    () => ({
      proposalMode: true,
      proposalTag: DAO_PROPOSAL_TAG,
      proposalPublishingEnabled: Boolean(isValidated),
      composerPlaceholder: isValidated
        ? 'Draft your IdenaDAO proposal here. Posts tagged with #IdenaDAO become visible in this governance view.'
        : 'Validation required. You can review IdenaDAO proposals here, but only validated identities can publish a new tagged proposal from this section.',
      composerPrefillText: isValidated ? DAO_PROPOSAL_TEMPLATE : '',
      composerHint: isValidated
        ? 'Start from the template, keep the #IdenaDAO tag, and publish through your own node RPC.'
        : 'Read-only proposal mode for your current identity status.',
    }),
    [isValidated]
  )

  const headerContent = (
    <Box
      borderWidth="1px"
      borderColor={isValidated ? 'green.100' : 'orange.100'}
      borderRadius="lg"
      bg={isValidated ? 'green.010' : 'orange.010'}
      px={4}
      py={4}
    >
      <Stack spacing={3}>
        <HStack spacing={2} flexWrap="wrap">
          <Badge colorScheme={isValidated ? 'green' : 'orange'}>
            {isValidated ? t('Validated identity') : t('Review mode')}
          </Badge>
          <Badge colorScheme="blue">{t('Integrated with idena.social')}</Badge>
          <Badge colorScheme="purple">
            {t('Status')}: {state || t('Unknown')}
          </Badge>
        </HStack>
        <Text fontSize="sm" lineHeight="tall">
          {isValidated
            ? t(
                'Use this section to publish governance proposals through the existing idena.social contract, with a proposal template already loaded for your identity.'
              )
            : t(
                'Use this section to review governance proposals. Proposal publishing from here is unlocked only for validated identities.'
              )}
        </Text>
        <Text color="muted" fontSize="sm" lineHeight="tall">
          {t('Current identity')}: <strong>{shortAddress(address)}</strong>.{' '}
          {t('Only posts containing')} <strong>{DAO_PROPOSAL_TAG}</strong>{' '}
          {t('are highlighted in this view.')}
        </Text>
        <HStack spacing={3} flexWrap="wrap">
          <TextLink href="/social" fontSize="sm">
            {t('Open full community feed')}
          </TextLink>
          <ExternalLink
            href={`https://scan.idena.io/contract/${SOCIAL_CONTRACT_ADDRESS}`}
            fontSize="sm"
          >
            {t('Inspect social contract')}
          </ExternalLink>
        </HStack>
      </Stack>
    </Box>
  )

  const footerContent = (
    <Text color="muted" fontSize="sm" lineHeight="tall">
      {isValidated
        ? t(
            'Proposal mode keeps the composer focused on tagged governance posts while the rest of the embedded experience still runs through your own node RPC.'
          )
        : t(
            'You can still browse tagged proposals and open the full social feed, but this section will not preload a proposal draft until your identity is validated.'
          )}
    </Text>
  )

  return (
    <SocialDesktopEmbed
      title="IdenaDAO"
      description={t(
        'A governance-focused surface built on top of idena.social. Publish, review, and discuss proposals inside the desktop app without leaving your node-backed environment.'
      )}
      headerContent={headerContent}
      footerContent={footerContent}
      bootstrapOverrides={bootstrapOverrides}
      iframeTitle="IdenaDAO"
    />
  )
}
