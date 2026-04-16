import React, {useEffect, useReducer, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import Ansi from 'ansi-to-react'
import {
  Box,
  Text,
  Heading,
  Stack,
  InputRightElement,
  InputGroup,
  IconButton,
  Flex,
  useToast,
  Switch,
} from '@chakra-ui/react'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {BASE_API_URL} from '../../shared/api/api-client'
import {
  useSettingsState,
  useSettingsDispatch,
} from '../../shared/providers/settings-context'
import {
  useNodeState,
  useNodeDispatch,
} from '../../shared/providers/node-context'
import {HDivider, Input, Toast} from '../../shared/components/components'
import {
  SettingsFormControl,
  SettingsFormLabel,
  SettingsSection,
} from '../../screens/settings/components'
import SettingsLayout from '../../screens/settings/layout'
import {EyeIcon, EyeOffIcon} from '../../shared/components/icons'
import {getNodeBridge} from '../../shared/utils/node-bridge'

function hasNodeBridge() {
  return !getNodeBridge().__idenaFallback
}

function normalizeLogs(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trimEnd()).filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((entry) => entry.trimEnd())
      .filter(Boolean)
  }

  return []
}

function NodeSettings() {
  const {t} = useTranslation()

  const toast = useToast()

  const settings = useSettingsState()

  const {
    toggleUseExternalNode,
    toggleRunInternalNode,
    setConnectionDetails,
    toggleAutoActivateMining,
  } = useSettingsDispatch()

  const {nodeFailed, nodeReady, nodeStarted} = useNodeState()

  const {tryRestartNode} = useNodeDispatch()

  const logsRef = useRef(null)
  const canUseIpcRenderer = hasNodeBridge()

  const [state, dispatch] = useReducer(
    (prevState, action) => {
      switch (action.type) {
        case 'SET_URL':
          return {
            ...prevState,
            url: action.data,
          }
        case 'SET_API_KEY': {
          return {
            ...prevState,
            apiKey: action.data,
          }
        }
        case 'SET_CONNECTION_DETAILS': {
          return {
            ...prevState,
            ...action,
          }
        }
        case 'NEW_LOG': {
          const nextLogs = normalizeLogs(action.data)
          const prevLogs =
            prevState.logs.length > 200
              ? prevState.logs.slice(-100)
              : prevState.logs
          return {
            ...prevState,
            logs: [...prevLogs, ...nextLogs],
          }
        }
        case 'SET_LAST_LOGS': {
          return {
            ...prevState,
            logs: normalizeLogs(action.data),
          }
        }
        default:
      }
    },
    {
      logs: [],
      url: settings.url,
      apiKey: settings.externalApiKey,
    }
  )

  useEffect(() => {
    if (!canUseIpcRenderer) {
      return undefined
    }

    const onEvent = (event, data) => {
      switch (event) {
        case 'node-log':
          if (!settings.useExternalNode) dispatch({type: 'NEW_LOG', data})
          break
        case 'last-node-logs':
          dispatch({type: 'SET_LAST_LOGS', data})
          break
        default:
      }
    }

    return getNodeBridge().onEvent(onEvent)
  }, [canUseIpcRenderer, settings.useExternalNode])

  useEffect(() => {
    if (canUseIpcRenderer && !settings.useExternalNode) {
      getNodeBridge().getLastLogs()
    }
  }, [canUseIpcRenderer, settings.useExternalNode])

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [state.logs])

  const notify = () =>
    toast({
      // eslint-disable-next-line react/display-name
      render: () => (
        <Toast
          title={t('Settings updated')}
          description={t('Connected to url', {url: state.url})}
        />
      ),
    })

  const [revealApiKey, setRevealApiKey] = useState(false)
  const emptyLogMessage = (() => {
    if (!canUseIpcRenderer) {
      return t(
        'The built-in node log is unavailable because the desktop bridge is not ready.'
      )
    }

    if (nodeFailed) {
      return t(
        'No node log was captured yet. The last startup failed before the live log stream was ready.'
      )
    }

    return t('Node output will appear here after the built-in node starts.')
  })()

  return (
    <SettingsLayout>
      <Stack spacing={8} mt={8}>
        <Stack spacing={4} maxW="md">
          <Stack isInline spacing={4} align="center">
            <Box>
              <Switch
                isChecked={settings.runInternalNode}
                onChange={() => {
                  toggleRunInternalNode(!settings.runInternalNode)
                }}
              />
            </Box>
            <Box>
              <Text fontWeight={500}>{t('Run built-in node')}</Text>
              <Text color="muted">
                {t('Use built-in node to have automatic updates')}
              </Text>
            </Box>
            {settings.runInternalNode && nodeFailed && (
              <Box>
                <Text color="red.500">{t('Node failed to start')}</Text>
                <SecondaryButton onClick={() => tryRestartNode()}>
                  {t('Try restart')}
                </SecondaryButton>
              </Box>
            )}
          </Stack>

          <Stack isInline spacing={3} align="center">
            <Box>
              <Switch
                isChecked={settings.autoActivateMining}
                isDisabled={!settings.runInternalNode}
                onChange={() => {
                  toggleAutoActivateMining()
                  getNodeBridge().restartNode()
                }}
              />
            </Box>
            <Box>
              <Text fontWeight={500}>
                {t('Activate mining status automatically')}
              </Text>
              <Text color="muted">
                {t(
                  'If your identity status is validated the mining will be activated automatically once the node is synchronized'
                )}
              </Text>
            </Box>
          </Stack>

          <HDivider />

          <Stack isInline spacing={3} align="center">
            <Box>
              <Switch
                isChecked={settings.useExternalNode}
                onChange={() => {
                  toggleUseExternalNode(!settings.useExternalNode)
                }}
              />
            </Box>
            <Box>
              <Text fontWeight={500}>{t('Connect to remote node')}</Text>
              <Text color="muted">
                {t(
                  'Specify the Node address if you want to connect to remote node'
                )}
              </Text>
            </Box>
          </Stack>
        </Stack>

        {settings.useExternalNode && (
          <SettingsSection title={t('Node settings')}>
            <Stack
              spacing={3}
              as="form"
              onSubmit={(e) => {
                e.preventDefault()
                setConnectionDetails(state)
                notify()
              }}
            >
              <SettingsFormControl>
                <SettingsFormLabel htmlFor="url">
                  {t('Node address')}
                </SettingsFormLabel>
                <Input
                  id="url"
                  value={state.url}
                  onChange={(e) =>
                    dispatch({type: 'SET_URL', data: e.target.value})
                  }
                />
              </SettingsFormControl>
              <SettingsFormControl>
                <SettingsFormLabel htmlFor="key">
                  {t('Node api key')}
                </SettingsFormLabel>
                <InputGroup>
                  <Input
                    id="key"
                    value={state.apiKey}
                    type={revealApiKey ? 'text' : 'password'}
                    onChange={(e) =>
                      dispatch({type: 'SET_API_KEY', data: e.target.value})
                    }
                  />
                  <InputRightElement w="6" h="6" m="1">
                    <IconButton
                      size="xs"
                      icon={revealApiKey ? <EyeOffIcon /> : <EyeIcon />}
                      bg={revealApiKey ? 'gray.300' : 'white'}
                      fontSize={20}
                      _hover={{
                        bg: revealApiKey ? 'gray.300' : 'white',
                      }}
                      onClick={() => setRevealApiKey(!revealApiKey)}
                    />
                  </InputRightElement>
                </InputGroup>
              </SettingsFormControl>
              <Stack isInline spacing={2} align="center" justify="flex-end">
                <SecondaryButton
                  ml="auto"
                  type="button"
                  onClick={() => {
                    dispatch({type: 'SET_URL', data: BASE_API_URL})
                  }}
                >
                  {t('Use default')}
                </SecondaryButton>
                <PrimaryButton type="submit">{t('Save')}</PrimaryButton>
              </Stack>
            </Stack>
          </SettingsSection>
        )}

        {!settings.useExternalNode && (
          <Box>
            <Heading fontWeight={500} fontSize="lg" mb={4}>
              {t('Built-in node log')}
            </Heading>
            <Flex
              ref={logsRef}
              direction="column"
              height="xs"
              overflow="auto"
              wordBreak="break-word"
              borderColor="muted"
              borderWidth="px"
              fontSize="sm"
              fontFamily="mono"
              px={3}
              py={2}
            >
              {state.logs.length > 0 ? (
                state.logs.map((log, idx) => <Ansi key={idx}>{log}</Ansi>)
              ) : (
                <Text color="muted">{emptyLogMessage}</Text>
              )}
            </Flex>
          </Box>
        )}
      </Stack>
    </SettingsLayout>
  )
}

export default NodeSettings
