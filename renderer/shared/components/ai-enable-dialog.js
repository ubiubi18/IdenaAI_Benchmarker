/* eslint-disable react/prop-types */
import React, {useEffect, useMemo, useState} from 'react'
import {
  Box,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Stack,
  Text,
  InputGroup,
  InputRightElement,
  IconButton,
  useToast,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {Input, Select, Toast} from './components'
import {PrimaryButton, SecondaryButton} from './button'
import {EyeIcon, EyeOffIcon} from './icons'
import {isLocalAiProvider} from '../utils/ai-provider-readiness'

function ensureBridge() {
  if (!global.aiSolver) {
    throw new Error('AI bridge is not available in this build')
  }
  return global.aiSolver
}

export function AiEnableDialog({
  isOpen,
  onClose,
  defaultProvider = 'openai',
  providerOptions = [],
  onComplete,
}) {
  const {t} = useTranslation()
  const toast = useToast()
  const [provider, setProvider] = useState(defaultProvider)
  const [apiKey, setApiKey] = useState('')
  const [savedProviders, setSavedProviders] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setProvider(defaultProvider)
    setApiKey('')
    setSavedProviders([])
    setIsApiKeyVisible(false)
  }, [defaultProvider, isOpen])

  const notify = (title, description, status = 'info') => {
    toast({
      render: () => (
        <Toast title={title} description={description} status={status} />
      ),
    })
  }

  const trimmedApiKey = String(apiKey || '').trim()
  const isLocalProvider = isLocalAiProvider(provider)
  const selectedProvidersLabel = useMemo(
    () => savedProviders.map(String).join(', '),
    [savedProviders]
  )

  const persistCurrentProviderKey = async () => {
    const nextKey = String(apiKey || '').trim()
    if (isLocalProvider) {
      throw new Error('Local AI does not use a session API key.')
    }

    if (!nextKey) {
      throw new Error('Paste an API key first.')
    }

    const bridge = ensureBridge()
    await bridge.setProviderKey({
      provider,
      apiKey: nextKey,
    })
    setSavedProviders((prev) =>
      prev.includes(provider) ? prev : [...prev, provider]
    )
    setApiKey('')
    setIsApiKeyVisible(false)
  }

  const finishSetup = async () => {
    setIsSaving(true)
    try {
      let providers = savedProviders

      if (!isLocalProvider && trimmedApiKey) {
        await persistCurrentProviderKey()
        providers = savedProviders.includes(provider)
          ? savedProviders
          : [...savedProviders, provider]
      }

      if (providers.length === 0) {
        const bridge = ensureBridge()
        if (isLocalProvider) {
          await bridge.testProvider({provider})
        } else {
          const result = await bridge.hasProviderKey({provider})
          if (!result || !result.hasKey) {
            throw new Error(
              'Load at least one provider key before enabling AI.'
            )
          }
        }
        providers = [provider]
      }

      if (typeof onComplete === 'function') {
        await onComplete({provider, providers})
      }

      onClose()
    } catch (error) {
      notify(
        t('Unable to enable AI'),
        String((error && error.message) || error || '').trim(),
        'error'
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{t('Enable experimental AI features')}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing={4}>
            <Text color="muted" fontSize="sm">
              {t(
                'Choose one or more AI providers. Cloud providers need a session API key for this desktop session. Local AI uses the runtime configured on the AI settings page.'
              )}
            </Text>

            <Box
              borderWidth="1px"
              borderColor="blue.050"
              borderRadius="md"
              p={3}
            >
              <Stack spacing={2}>
                <Text fontWeight={500}>{t('Provider')}</Text>
                <Select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  w="sm"
                >
                  {providerOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                <Text color="muted" fontSize="xs">
                  {isLocalProvider
                    ? t(
                        'Local AI does not need a session key. Finish setup, then make sure the Local AI runtime is enabled and reachable on the AI settings page.'
                      )
                    : t(
                        'You can save one provider now, then switch provider and add another before finishing.'
                      )}
                </Text>
              </Stack>
            </Box>

            {!isLocalProvider ? (
              <Box
                borderWidth="1px"
                borderColor="gray.100"
                borderRadius="md"
                p={3}
              >
                <Stack spacing={3}>
                  <Text fontWeight={500}>{t('Session API key')}</Text>
                  <InputGroup w="full">
                    <Input
                      value={apiKey}
                      type={isApiKeyVisible ? 'text' : 'password'}
                      placeholder={t('Paste API key for the selected provider')}
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
                  <Stack isInline justify="flex-end">
                    <SecondaryButton
                      isDisabled={!trimmedApiKey}
                      isLoading={isSaving}
                      onClick={async () => {
                        setIsSaving(true)
                        try {
                          await persistCurrentProviderKey()
                          notify(
                            t('Provider key saved'),
                            t('{{provider}} is ready for this session.', {
                              provider,
                            })
                          )
                        } catch (error) {
                          notify(
                            t('Unable to save provider key'),
                            String(
                              (error && error.message) || error || ''
                            ).trim(),
                            'error'
                          )
                        } finally {
                          setIsSaving(false)
                        }
                      }}
                    >
                      {t('Save provider key')}
                    </SecondaryButton>
                  </Stack>
                </Stack>
              </Box>
            ) : null}

            <Box
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="md"
              p={3}
            >
              <Stack spacing={1}>
                <Text fontWeight={500}>
                  {t('Ready providers for this setup')}
                </Text>
                <Text color="muted" fontSize="sm">
                  {selectedProvidersLabel || t('None saved yet')}
                </Text>
              </Stack>
            </Box>
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Stack isInline spacing={2}>
            <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
            <PrimaryButton isLoading={isSaving} onClick={finishSetup}>
              {t('Enable AI')}
            </PrimaryButton>
          </Stack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
