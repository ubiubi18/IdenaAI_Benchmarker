/* eslint-disable react/prop-types */
import React from 'react'
import {Stack, Text} from '@chakra-ui/react'
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
                onClick={() => router.push('/flips/new?focus=ai-benchmark')}
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
