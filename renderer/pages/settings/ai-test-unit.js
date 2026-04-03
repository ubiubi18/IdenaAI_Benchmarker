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
        <SettingsSection title={t('Local AI test unit')}>
          <Stack spacing={4}>
            <Box
              borderWidth="1px"
              borderColor="blue.050"
              borderRadius="md"
              p={4}
            >
              <Stack spacing={2}>
                <Text fontWeight={500}>{t('Simple flow (few clicks)')}</Text>
                <Text color="muted" fontSize="sm">
                  {t(
                    '1) Set AI key in AI Solver settings. 2) Open Flip Builder directly in submit step. 3) Add flip to queue. 4) Run short or long.'
                  )}
                </Text>
                <Stack isInline spacing={2}>
                  <PrimaryButton onClick={() => router.push('/settings/ai')}>
                    {t('Open AI Solver settings')}
                  </PrimaryButton>
                  <PrimaryButton
                    onClick={() =>
                      router.push(
                        '/flips/new?focus=ai-benchmark&autostep=submit'
                      )
                    }
                  >
                    {t('Start simple benchmark')}
                  </PrimaryButton>
                </Stack>
              </Stack>
            </Box>
            <Text color="muted">
              {t(
                'Benchmark tools run in the regular flip builder flow and validation preview.'
              )}
            </Text>
            <Text color="muted">
              {t(
                'Use Flips -> New -> Submit to add/import flips and start queue/json runs.'
              )}
            </Text>
            <Stack isInline spacing={2}>
              <PrimaryButton
                onClick={() =>
                  router.push('/flips/new?focus=ai-benchmark&autostep=submit')
                }
              >
                {t('Open flip builder benchmark')}
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
