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
import {getSharedGlobal} from '../utils/shared-global'

const LOCAL_AI_COMFORT_MEMORY_GIB = 32

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
  const [showExternalProviders, setShowExternalProviders] = useState(false)
  const totalSystemMemoryBytes = Number(
    getSharedGlobal('totalSystemMemoryBytes', 0)
  )
  const totalSystemMemoryGiB =
    Number.isFinite(totalSystemMemoryBytes) && totalSystemMemoryBytes > 0
      ? Math.max(1, Math.round(totalSystemMemoryBytes / 1024 ** 3))
      : 0
  const externalProviderSectionRef = React.useRef(null)
  const apiKeyInputRef = React.useRef(null)
  const hasLocalProviderOption = useMemo(
    () => providerOptions.some((item) => isLocalAiProvider(item.value)),
    [providerOptions]
  )
  const firstExternalProvider = useMemo(
    () =>
      providerOptions.find((item) => !isLocalAiProvider(item.value))?.value ||
      'openai',
    [providerOptions]
  )

  useEffect(() => {
    if (!isOpen) return
    setProvider(defaultProvider)
    setApiKey('')
    setSavedProviders([])
    setIsApiKeyVisible(false)
    setShowExternalProviders(!isLocalAiProvider(defaultProvider))
  }, [defaultProvider, isOpen])

  const trimmedApiKey = String(apiKey || '').trim()
  const isLocalProvider = isLocalAiProvider(provider)
  const selectedProvidersLabel = useMemo(
    () => savedProviders.map(String).join(', '),
    [savedProviders]
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !isOpen || isLocalProvider) {
      return
    }

    const requestId = window.requestAnimationFrame(() => {
      if (
        externalProviderSectionRef.current &&
        typeof externalProviderSectionRef.current.scrollIntoView === 'function'
      ) {
        externalProviderSectionRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
      }

      if (
        apiKeyInputRef.current &&
        typeof apiKeyInputRef.current.focus === 'function'
      ) {
        apiKeyInputRef.current.focus()
      }
    })

    return () => {
      window.cancelAnimationFrame(requestId)
    }
  }, [isLocalProvider, isOpen, provider, showExternalProviders])

  const notify = (title, description, status = 'info') => {
    toast({
      render: () => (
        <Toast title={title} description={description} status={status} />
      ),
    })
  }

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

      if (isLocalProvider) {
        providers = [provider]
      } else if (trimmedApiKey) {
        await persistCurrentProviderKey()
        providers = savedProviders.includes(provider)
          ? savedProviders
          : [...savedProviders, provider]
      }

      if (!isLocalProvider && providers.length === 0) {
        const bridge = ensureBridge()

        const result = await bridge.hasProviderKey({provider})
        if (!result || !result.hasKey) {
          throw new Error('Load at least one provider key before enabling AI.')
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
    <Modal isOpen={isOpen} onClose={onClose} size="xl" isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{t('Enable experimental AI features')}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing={4}>
            <Text color="muted" fontSize="sm">
              {hasLocalProviderOption
                ? t(
                    'Recommended for new installs: let IdenaAI prepare the local runtime on this device. You only need an external API key if you explicitly want a cloud provider instead.'
                  )
                : t(
                    'Choose one or more AI providers. Cloud providers need a session API key for this desktop session.'
                  )}
            </Text>

            {isLocalProvider ? (
              <Box
                borderWidth="1px"
                borderColor="green.100"
                borderRadius="md"
                p={3}
                bg="green.010"
              >
                <Stack spacing={3}>
                  <Box>
                    <Text fontWeight={600}>
                      {t('Recommended: local AI on this device')}
                    </Text>
                    <Text color="muted" fontSize="sm" mt={1}>
                      {t(
                        'IdenaAI will prepare the managed local runtime for you. The model stays on this machine. First startup can take several minutes and uses local disk space.'
                      )}
                    </Text>
                  </Box>
                  <Text color="muted" fontSize="xs">
                    {t(
                      'You do not need to paste any API key for this path. One confirmation is enough.'
                    )}
                  </Text>
                  <Text
                    color={
                      totalSystemMemoryGiB > 0 &&
                      totalSystemMemoryGiB < LOCAL_AI_COMFORT_MEMORY_GIB
                        ? 'orange.500'
                        : 'muted'
                    }
                    fontSize="xs"
                  >
                    {totalSystemMemoryGiB > 0
                      ? t(
                          'This desktop has {{count}} GB RAM installed. Managed local AI is much safer around {{recommended}} GB and above. Smaller machines can still try it, but startup or live-session failures are more likely.',
                          {
                            count: totalSystemMemoryGiB,
                            recommended: LOCAL_AI_COMFORT_MEMORY_GIB,
                          }
                        )
                      : t(
                          'Managed local AI needs significant RAM headroom. Smaller machines can still try it, but startup or live-session failures are more likely.'
                        )}
                  </Text>
                  {hasLocalProviderOption ? (
                    <Stack isInline spacing={2} flexWrap="wrap">
                      <SecondaryButton
                        onClick={() => {
                          setProvider(firstExternalProvider)
                          setShowExternalProviders(true)
                        }}
                      >
                        {t('Use external provider API instead')}
                      </SecondaryButton>
                    </Stack>
                  ) : null}
                </Stack>
              </Box>
            ) : null}

            {showExternalProviders || !isLocalProvider ? (
              <Box
                ref={externalProviderSectionRef}
                borderWidth="1px"
                borderColor="blue.050"
                borderRadius="md"
                p={3}
              >
                <Stack spacing={2}>
                  <Text fontWeight={500}>
                    {t('Provider choice and session key')}
                  </Text>
                  <Select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    w="sm"
                  >
                    {providerOptions
                      .filter(
                        (item) =>
                          showExternalProviders ||
                          !isLocalAiProvider(item.value)
                      )
                      .map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                  </Select>
                  <Text color="muted" fontSize="xs">
                    {t(
                      'Cloud providers need a session API key. Use this only when you intentionally want an external API instead of local AI on this device.'
                    )}
                  </Text>
                  {!isLocalProvider ? (
                    <>
                      <InputGroup w="full">
                        <Input
                          ref={apiKeyInputRef}
                          value={apiKey}
                          type={isApiKeyVisible ? 'text' : 'password'}
                          placeholder={t(
                            'Paste API key for the selected provider'
                          )}
                          onChange={(e) => setApiKey(e.target.value)}
                        />
                        <InputRightElement w="6" h="6" m="1">
                          <IconButton
                            size="xs"
                            icon={
                              isApiKeyVisible ? <EyeOffIcon /> : <EyeIcon />
                            }
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
                    </>
                  ) : null}
                  {hasLocalProviderOption ? (
                    <SecondaryButton
                      alignSelf="flex-start"
                      onClick={() => {
                        setProvider('local-ai')
                        setShowExternalProviders(false)
                      }}
                    >
                      {t('Back to local AI')}
                    </SecondaryButton>
                  ) : null}
                </Stack>
              </Box>
            ) : null}

            {!isLocalProvider ? (
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
            ) : null}
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Stack isInline spacing={2}>
            <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
            <PrimaryButton isLoading={isSaving} onClick={finishSetup}>
              {isLocalProvider
                ? t('Prepare local AI')
                : t('Enable API provider')}
            </PrimaryButton>
          </Stack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
