/* eslint-disable react/prop-types */
import React, {useMemo, useState} from 'react'
import {
  Box,
  Flex,
  Stack,
  Text,
  Switch,
  useToast,
  InputRightElement,
  InputGroup,
  IconButton,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import SettingsLayout from '../../screens/settings/layout'
import {
  SettingsFormControl,
  SettingsFormLabel,
  SettingsSection,
} from '../../screens/settings/components'
import {Input, Select, Toast} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../../shared/providers/settings-context'
import {EyeIcon, EyeOffIcon} from '../../shared/components/icons'

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
}

const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: 'openai',
  model: DEFAULT_MODELS.openai,
  mode: 'manual',
  benchmarkProfile: 'strict',
  deadlineMs: 80 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 2,
  maxRetries: 1,
  maxOutputTokens: 120,
}

function numberOrFallback(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export default function AiSettingsPage() {
  const {t} = useTranslation()
  const toast = useToast()

  const settings = useSettingsState()
  const {updateAiSolverSettings} = useSettingsDispatch()

  const aiSolver = useMemo(
    () => ({...DEFAULT_AI_SETTINGS, ...(settings.aiSolver || {})}),
    [settings.aiSolver]
  )

  const [apiKey, setApiKey] = useState('')
  const [isUpdatingKey, setIsUpdatingKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)

  const notify = (title, description, status = 'info') => {
    toast({
      render: () => (
        <Toast title={title} description={description} status={status} />
      ),
    })
  }

  const updateNumberField = (field, value) => {
    updateAiSolverSettings({
      [field]: numberOrFallback(value, DEFAULT_AI_SETTINGS[field]),
    })
  }

  const updateProvider = (provider) => {
    updateAiSolverSettings({
      provider,
      model: DEFAULT_MODELS[provider],
    })
  }

  const ensureBridge = () => {
    if (!global.aiSolver) {
      throw new Error('AI bridge is not available in this build')
    }
    return global.aiSolver
  }

  const activeProvider = aiSolver.provider || 'openai'

  return (
    <SettingsLayout>
      <Stack spacing={8} mt={8} maxW="2xl">
        <SettingsSection title={t('AI benchmark helper')}>
          <Stack spacing={4}>
            <Box
              bg="orange.012"
              borderWidth="1px"
              borderColor="orange.050"
              p={4}
              borderRadius="md"
            >
              <Text fontWeight={500} color="orange.500">
                {t('Research mode only')}
              </Text>
              <Text color="muted" mt={1}>
                {t(
                  'This helper is for benchmark research and sends flip images to selected AI cloud providers. Do not use it on Idena mainnet.'
                )}
              </Text>
            </Box>

            <Flex align="center" justify="space-between">
              <Box>
                <Text fontWeight={500}>{t('Enable AI helper')}</Text>
                <Text color="muted">
                  {t(
                    'Allows one-click or auto-run solving during short session.'
                  )}
                </Text>
              </Box>
              <Switch
                isChecked={!!aiSolver.enabled}
                onChange={() => {
                  updateAiSolverSettings({enabled: !aiSolver.enabled})
                }}
              />
            </Flex>

            <SettingsFormControl>
              <SettingsFormLabel>{t('Provider')}</SettingsFormLabel>
              <Select
                value={activeProvider}
                onChange={(e) => updateProvider(e.target.value)}
                w="xs"
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Google Gemini</option>
              </Select>
            </SettingsFormControl>

            <SettingsFormControl>
              <SettingsFormLabel>{t('Model')}</SettingsFormLabel>
              <Input
                value={aiSolver.model || DEFAULT_MODELS[activeProvider]}
                onChange={(e) =>
                  updateAiSolverSettings({
                    model: e.target.value,
                  })
                }
                w="xs"
              />
            </SettingsFormControl>

            <SettingsFormControl>
              <SettingsFormLabel>{t('Run mode')}</SettingsFormLabel>
              <Select
                value={aiSolver.mode || 'manual'}
                onChange={(e) => updateAiSolverSettings({mode: e.target.value})}
                w="xs"
              >
                <option value="manual">{t('Manual one-click')}</option>
                <option value="session-auto">
                  {t('Auto-run each short session')}
                </option>
              </Select>
            </SettingsFormControl>

            <SettingsFormControl>
              <SettingsFormLabel>{t('Benchmark profile')}</SettingsFormLabel>
              <Select
                value={aiSolver.benchmarkProfile || 'strict'}
                onChange={(e) =>
                  updateAiSolverSettings({benchmarkProfile: e.target.value})
                }
                w="xs"
              >
                <option value="strict">{t('Strict default')}</option>
                <option value="custom">{t('Custom research')}</option>
              </Select>
            </SettingsFormControl>

            <Text color="muted" fontSize="sm">
              {aiSolver.benchmarkProfile === 'strict'
                ? t(
                    'Strict profile applies fixed timing, retries and output limits for fair customer-side benchmark comparison.'
                  )
                : t(
                    'Custom profile allows local overrides for exploratory research. All custom settings are logged in benchmark metrics.'
                  )}
            </Text>

            {aiSolver.benchmarkProfile === 'custom' && (
              <Stack spacing={3}>
                <SettingsFormControl>
                  <SettingsFormLabel>
                    {t('Session deadline (ms)')}
                  </SettingsFormLabel>
                  <Input
                    type="number"
                    min={10000}
                    max={180000}
                    value={aiSolver.deadlineMs}
                    onChange={(e) =>
                      updateNumberField('deadlineMs', e.target.value)
                    }
                    w="xs"
                  />
                </SettingsFormControl>
                <SettingsFormControl>
                  <SettingsFormLabel>
                    {t('Request timeout (ms)')}
                  </SettingsFormLabel>
                  <Input
                    type="number"
                    min={1000}
                    max={30000}
                    value={aiSolver.requestTimeoutMs}
                    onChange={(e) =>
                      updateNumberField('requestTimeoutMs', e.target.value)
                    }
                    w="xs"
                  />
                </SettingsFormControl>
                <SettingsFormControl>
                  <SettingsFormLabel>{t('Max concurrency')}</SettingsFormLabel>
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    value={aiSolver.maxConcurrency}
                    onChange={(e) =>
                      updateNumberField('maxConcurrency', e.target.value)
                    }
                    w="xs"
                  />
                </SettingsFormControl>
                <SettingsFormControl>
                  <SettingsFormLabel>{t('Max retries')}</SettingsFormLabel>
                  <Input
                    type="number"
                    min={0}
                    max={3}
                    value={aiSolver.maxRetries}
                    onChange={(e) =>
                      updateNumberField('maxRetries', e.target.value)
                    }
                    w="xs"
                  />
                </SettingsFormControl>
                <SettingsFormControl>
                  <SettingsFormLabel>
                    {t('Max output tokens')}
                  </SettingsFormLabel>
                  <Input
                    type="number"
                    min={16}
                    max={512}
                    value={aiSolver.maxOutputTokens}
                    onChange={(e) =>
                      updateNumberField('maxOutputTokens', e.target.value)
                    }
                    w="xs"
                  />
                </SettingsFormControl>
              </Stack>
            )}
          </Stack>
        </SettingsSection>

        <SettingsSection title={t('Provider key (session only)')}>
          <Stack spacing={3}>
            <Text color="muted" fontSize="sm">
              {t(
                'The API key is kept in memory only for this desktop run and is not persisted to settings by default.'
              )}
            </Text>

            <SettingsFormControl>
              <SettingsFormLabel>{t('API key')}</SettingsFormLabel>
              <InputGroup w="full" maxW="xl">
                <Input
                  value={apiKey}
                  type={isApiKeyVisible ? 'text' : 'password'}
                  placeholder={t('Paste provider API key')}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <InputRightElement w="6" h="6" m="1">
                  <IconButton
                    size="xs"
                    icon={isApiKeyVisible ? <EyeOffIcon /> : <EyeIcon />}
                    bg={isApiKeyVisible ? 'gray.300' : 'white'}
                    fontSize={20}
                    _hover={{
                      bg: isApiKeyVisible ? 'gray.300' : 'white',
                    }}
                    onClick={() => setIsApiKeyVisible(!isApiKeyVisible)}
                  />
                </InputRightElement>
              </InputGroup>
            </SettingsFormControl>

            <Stack isInline justify="flex-end" spacing={2}>
              <SecondaryButton
                isLoading={isUpdatingKey}
                onClick={async () => {
                  setIsUpdatingKey(true)
                  try {
                    const bridge = ensureBridge()
                    await bridge.clearProviderKey({provider: activeProvider})
                    setApiKey('')
                    notify(
                      t('Provider key cleared'),
                      t('The session key has been removed from memory.')
                    )
                  } catch (error) {
                    notify(t('Unable to clear key'), error.toString(), 'error')
                  } finally {
                    setIsUpdatingKey(false)
                  }
                }}
              >
                {t('Clear key')}
              </SecondaryButton>

              <SecondaryButton
                isDisabled={!apiKey}
                isLoading={isUpdatingKey}
                onClick={async () => {
                  setIsUpdatingKey(true)
                  try {
                    const bridge = ensureBridge()
                    await bridge.setProviderKey({
                      provider: activeProvider,
                      apiKey,
                    })
                    setApiKey('')
                    notify(
                      t('Provider key set'),
                      t('The session key was loaded and is ready for requests.')
                    )
                  } catch (error) {
                    notify(t('Unable to set key'), error.toString(), 'error')
                  } finally {
                    setIsUpdatingKey(false)
                  }
                }}
              >
                {t('Set key')}
              </SecondaryButton>

              <PrimaryButton
                isLoading={isTesting}
                onClick={async () => {
                  setIsTesting(true)
                  try {
                    const bridge = ensureBridge()
                    const result = await bridge.testProvider({
                      provider: activeProvider,
                      model: aiSolver.model,
                    })
                    notify(
                      t('Provider is reachable'),
                      t('{{provider}} {{model}} in {{latency}} ms', {
                        provider: result.provider,
                        model: result.model,
                        latency: result.latencyMs,
                      })
                    )
                  } catch (error) {
                    notify(t('Provider test failed'), error.toString(), 'error')
                  } finally {
                    setIsTesting(false)
                  }
                }}
              >
                {t('Test connection')}
              </PrimaryButton>
            </Stack>
          </Stack>
        </SettingsSection>
      </Stack>
    </SettingsLayout>
  )
}
