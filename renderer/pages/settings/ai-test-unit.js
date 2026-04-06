/* eslint-disable react/prop-types */
import React from 'react'
import {Box, Stack, Text} from '@chakra-ui/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import SettingsLayout from '../../screens/settings/layout'
import {SettingsSection} from '../../screens/settings/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'

export default function AiTestUnitPage() {
  const {t} = useTranslation()
  const router = useRouter()

  return (
    <SettingsLayout>
      <Stack spacing={8} mt={8} maxW="2xl">
        <SettingsSection title={t('AI moved here')}>
          <Stack spacing={4}>
            <Box
              borderWidth="1px"
              borderColor="blue.050"
              borderRadius="md"
              p={4}
            >
              <Stack spacing={2}>
                <Text fontWeight={500}>{t('Use the central AI page')}</Text>
                <Text color="muted" fontSize="sm">
                  {t(
                    'AI Solver, AI Flip Builder, off-chain benchmark, and on-chain automatic flow are now grouped under one AI page.'
                  )}
                </Text>
                <Stack isInline spacing={2}>
                  <PrimaryButton onClick={() => router.push('/settings/ai')}>
                    {t('Open AI')}
                  </PrimaryButton>
                </Stack>
              </Stack>
            </Box>
            <Text color="muted">
              {t(
                'Start with provider selection and API key setup on the AI page first.'
              )}
            </Text>
            <Stack isInline spacing={2}>
              <PrimaryButton onClick={() => router.push('/settings/ai')}>
                {t('Open AI')}
              </PrimaryButton>
              <SecondaryButton
                onClick={() => router.push('/validation?previewAi=1')}
              >
                {t('Open validation preview')}
              </SecondaryButton>
            </Stack>
          </Stack>
        </SettingsSection>
      </Stack>
    </SettingsLayout>
  )
}
