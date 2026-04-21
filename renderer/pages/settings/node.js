import React, {useEffect, useReducer, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import Ansi from 'ansi-to-react'
import {useRouter} from 'next/router'
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
import {
  canOpenRehearsalValidation,
  getRehearsalValidationEntryPath,
  getRehearsalValidationBlockedReason,
  openValidationLottery,
} from '../../screens/validation/hooks/use-start-validation'

const REHEARSAL_NETWORK_NODE_COUNT = 9
const REHEARSAL_NETWORK_LEAD_SECONDS = 8 * 60
const REHEARSAL_NETWORK_FAST_FORWARD_START_LEAD_SECONDS = 8 * 60
const REHEARSAL_NETWORK_FAST_FORWARD_CONNECT_SECONDS = 90
const REHEARSAL_NETWORK_SEED_FLIP_COUNT = 27

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

function normalizeDevnetStatus(value) {
  if (!value || typeof value !== 'object') {
    return {
      active: false,
      stage: 'idle',
      message: '',
      error: null,
      primaryRpcUrl: null,
      nodeCount: 0,
      nodes: [],
      countdownSeconds: null,
      firstCeremonyAt: null,
      seedSource: null,
      seedRequestedCount: null,
      seedSubmittedCount: null,
      seedConfirmedCount: null,
      primaryValidationAssigned: false,
      primaryShortHashCount: null,
      primaryShortHashReadyCount: null,
      primaryLongHashCount: null,
      primaryLongHashReadyCount: null,
    }
  }

  return {
    active: Boolean(value.active),
    stage: value.stage || 'idle',
    message: value.message || '',
    error: value.error || null,
    primaryRpcUrl: value.primaryRpcUrl || null,
    nodeCount:
      typeof value.nodeCount === 'number' && value.nodeCount >= 0
        ? value.nodeCount
        : 0,
    nodes: Array.isArray(value.nodes) ? value.nodes : [],
    countdownSeconds:
      typeof value.countdownSeconds === 'number'
        ? value.countdownSeconds
        : null,
    firstCeremonyAt: value.firstCeremonyAt || null,
    networkId: value.networkId || null,
    seedSource: value.seedSource || null,
    seedRequestedCount:
      typeof value.seedRequestedCount === 'number'
        ? value.seedRequestedCount
        : null,
    seedSubmittedCount:
      typeof value.seedSubmittedCount === 'number'
        ? value.seedSubmittedCount
        : null,
    seedConfirmedCount:
      typeof value.seedConfirmedCount === 'number'
        ? value.seedConfirmedCount
        : null,
    primaryValidationAssigned: value.primaryValidationAssigned === true,
    primaryShortHashCount:
      typeof value.primaryShortHashCount === 'number'
        ? value.primaryShortHashCount
        : null,
    primaryShortHashReadyCount:
      typeof value.primaryShortHashReadyCount === 'number'
        ? value.primaryShortHashReadyCount
        : null,
    primaryLongHashCount:
      typeof value.primaryLongHashCount === 'number'
        ? value.primaryLongHashCount
        : null,
    primaryLongHashReadyCount:
      typeof value.primaryLongHashReadyCount === 'number'
        ? value.primaryLongHashReadyCount
        : null,
  }
}

function buildRehearsalNetworkPayload({
  connectApp = false,
  fastForward = false,
} = {}) {
  return {
    nodeCount: REHEARSAL_NETWORK_NODE_COUNT,
    firstCeremonyLeadSeconds: fastForward
      ? REHEARSAL_NETWORK_FAST_FORWARD_START_LEAD_SECONDS
      : REHEARSAL_NETWORK_LEAD_SECONDS,
    seedFlipCount: REHEARSAL_NETWORK_SEED_FLIP_COUNT,
    connectApp,
    connectCountdownSeconds:
      connectApp && fastForward
        ? REHEARSAL_NETWORK_FAST_FORWARD_CONNECT_SECONDS
        : null,
  }
}

function NodeSettings() {
  const {t} = useTranslation()
  const router = useRouter()

  const toast = useToast()

  const settings = useSettingsState()

  const {
    toggleUseExternalNode,
    toggleRunInternalNode,
    setConnectionDetails,
    connectEphemeralExternalNode,
    clearEphemeralExternalNode,
    toggleAutoActivateMining,
  } = useSettingsDispatch()

  const {nodeFailed} = useNodeState()

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
        case 'SET_DEVNET_STATUS': {
          return {
            ...prevState,
            devnetStatus: normalizeDevnetStatus(action.data),
          }
        }
        case 'NEW_DEVNET_LOG': {
          const nextLogs = normalizeLogs(action.data)
          const prevLogs =
            prevState.devnetLogs.length > 200
              ? prevState.devnetLogs.slice(-100)
              : prevState.devnetLogs

          return {
            ...prevState,
            devnetLogs: [...prevLogs, ...nextLogs],
          }
        }
        case 'SET_DEVNET_LOGS': {
          return {
            ...prevState,
            devnetLogs: normalizeLogs(action.data),
          }
        }
        default:
      }
    },
    {
      logs: [],
      devnetLogs: [],
      url: settings.url,
      apiKey: settings.externalApiKey,
      devnetStatus: normalizeDevnetStatus(),
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
        case 'validation-devnet-status':
          dispatch({type: 'SET_DEVNET_STATUS', data})
          if (!data?.active && settings.ephemeralExternalNodeConnected) {
            clearEphemeralExternalNode()
          }
          break
        case 'validation-devnet-log':
          dispatch({type: 'NEW_DEVNET_LOG', data})
          break
        case 'validation-devnet-logs':
          dispatch({type: 'SET_DEVNET_LOGS', data})
          break
        case 'validation-devnet-connect-payload':
          if (!data || !data.url || !data.apiKey) {
            break
          }

          connectEphemeralExternalNode({
            url: data.url,
            apiKey: data.apiKey,
            label: data.label,
          })

          toast({
            render: () => (
              <Toast
                title={t('Rehearsal node connected')}
                description={t(
                  'IdenaAI now uses the rehearsal node for this app session only. The secret is not saved to normal node settings.'
                )}
              />
            ),
          })
          break
        default:
      }
    }

    return getNodeBridge().onEvent(onEvent)
  }, [
    canUseIpcRenderer,
    clearEphemeralExternalNode,
    connectEphemeralExternalNode,
    dispatch,
    settings.ephemeralExternalNodeConnected,
    settings.useExternalNode,
    t,
    toast,
  ])

  useEffect(() => {
    if (settings.ephemeralExternalNodeConnected) {
      return
    }

    dispatch({
      type: 'SET_CONNECTION_DETAILS',
      url: settings.url,
      apiKey: settings.externalApiKey,
    })
  }, [
    dispatch,
    settings.ephemeralExternalNodeConnected,
    settings.externalApiKey,
    settings.url,
  ])

  useEffect(() => {
    if (canUseIpcRenderer && !settings.useExternalNode) {
      getNodeBridge().getLastLogs()
    }
  }, [canUseIpcRenderer, settings.useExternalNode])

  useEffect(() => {
    if (!canUseIpcRenderer) {
      return
    }

    getNodeBridge().getValidationDevnetStatus()
    getNodeBridge().getValidationDevnetLogs()
  }, [canUseIpcRenderer])

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
  const {devnetStatus} = state
  const isStartingDevnet =
    devnetStatus.stage &&
    !['idle', 'running', 'failed'].includes(devnetStatus.stage)
  const primaryRpcPort = devnetStatus.primaryRpcUrl
    ? Number(String(devnetStatus.primaryRpcUrl).split(':').pop())
    : null
  const primaryDevnetNode =
    devnetStatus.nodes.find(({rpcPort}) => rpcPort === primaryRpcPort) ||
    devnetStatus.nodes[0] ||
    null
  const rehearsalCurrentPeriod = primaryDevnetNode?.currentPeriod || null
  const rehearsalNodeConnected =
    settings.ephemeralExternalNodeConnected &&
    devnetStatus.primaryRpcUrl &&
    settings.url === devnetStatus.primaryRpcUrl
  const rehearsalNeedsConnection =
    devnetStatus.active && devnetStatus.primaryRpcUrl && !rehearsalNodeConnected
  const rehearsalNodeConnectable =
    rehearsalNeedsConnection && devnetStatus.stage === 'running'
  const rehearsalSessionAlreadyAdvanced =
    rehearsalNodeConnected &&
    ['ShortSession', 'LongSession', 'AfterLongSession'].includes(
      rehearsalCurrentPeriod
    )
  const rehearsalAwaitingFlipLottery =
    rehearsalNeedsConnection &&
    !devnetStatus.primaryValidationAssigned &&
    ![
      'FlipLottery',
      'ShortSession',
      'LongSession',
      'AfterLongSession',
    ].includes(rehearsalCurrentPeriod)
  const rehearsalConnectWarning =
    rehearsalNeedsConnection &&
    ['ShortSession', 'LongSession', 'AfterLongSession'].includes(
      rehearsalCurrentPeriod
    )
  const rehearsalBlockedReason = getRehearsalValidationBlockedReason({
    currentPeriod: rehearsalCurrentPeriod,
    devnetStatus,
    isRehearsalNodeSession: rehearsalNodeConnected,
  })
  const rehearsalValidationOpenable = canOpenRehearsalValidation({
    currentPeriod: rehearsalCurrentPeriod,
    devnetStatus,
    isRehearsalNodeSession: rehearsalNodeConnected,
  })
  const rehearsalCanOpenCountdown =
    rehearsalNodeConnected &&
    !['ShortSession', 'LongSession', 'AfterLongSession'].includes(
      rehearsalCurrentPeriod
    )
  let rehearsalConnectionMessage = ''
  let rehearsalSessionMessage = ''
  const rehearsalCurrentNodeStatusNote =
    rehearsalNeedsConnection &&
    settings.useExternalNode &&
    settings.url &&
    settings.url !== devnetStatus.primaryRpcUrl
      ? t(
          'Until the rehearsal handoff happens, the app sidebar still reflects your current node endpoint ({{url}}), not the rehearsal RPC.',
          {url: settings.url}
        )
      : ''

  if (rehearsalConnectWarning) {
    rehearsalConnectionMessage = t(
      'The rehearsal network is already running, but this app is still on your normal node and the ceremony has already progressed. Restart fresh for a clean run.'
    )
  } else if (rehearsalAwaitingFlipLottery) {
    rehearsalConnectionMessage = t(
      'The rehearsal network is healthy, and you can already switch this app over to the rehearsal node. Validation hashes have not been assigned yet because the primary node is still before FlipLottery.'
    )
  } else if (!devnetStatus.primaryValidationAssigned) {
    rehearsalConnectionMessage = t(
      'The rehearsal network is running and ready for app handoff. The primary node still has no assigned validation flips yet, so validation content will appear later when the ceremony reaches FlipLottery.'
    )
  } else {
    rehearsalConnectionMessage = t(
      'The rehearsal network is running in the background, but this app is still connected to your normal node. Switch this app over when you are ready.'
    )
  }

  if (rehearsalNodeConnected) {
    if (
      rehearsalBlockedReason === 'before-flip-lottery' ||
      rehearsalBlockedReason === 'flip-lottery'
    ) {
      rehearsalSessionMessage = t(
        'Rehearsal node is connected. Open the countdown and stay in the session window; validation content will appear there as soon as real rehearsal flips are ready.'
      )
    } else if (rehearsalBlockedReason === 'hashes-not-assigned') {
      rehearsalSessionMessage = t(
        'Rehearsal node is connected, but validation hashes are still not assigned on the primary node.'
      )
    } else if (rehearsalBlockedReason === 'keys-not-ready') {
      rehearsalSessionMessage = t(
        'Rehearsal node is connected, but flip decryption keys are still syncing. Validation will open once at least one flip is ready.'
      )
    } else if (rehearsalValidationOpenable) {
      rehearsalSessionMessage = t(
        'Rehearsal session is ready to open from this page.'
      )
    }
  }
  const emptyDevnetLogMessage = canUseIpcRenderer
    ? t(
        'Rehearsal-network output will appear here after the private validation network starts.'
      )
    : t(
        'The validation rehearsal network is unavailable because the desktop bridge is not ready.'
      )

  const startRehearsalNetwork = ({
    connectApp = false,
    fastForward = false,
  } = {}) =>
    getNodeBridge().startValidationDevnet(
      buildRehearsalNetworkPayload({connectApp, fastForward})
    )

  const restartRehearsalNetwork = ({
    connectApp = true,
    fastForward = false,
  } = {}) =>
    getNodeBridge().restartValidationDevnet(
      buildRehearsalNetworkPayload({connectApp, fastForward})
    )

  return (
    <SettingsLayout>
      <Stack spacing={8} mt={8}>
        <Stack spacing={4} maxW="md">
          <Stack isInline spacing={4} align="center">
            <Box>
              <Switch
                isChecked={settings.runInternalNode}
                onChange={() => {
                  clearEphemeralExternalNode()
                  getNodeBridge().clearExternalNodeOverride()
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
                  clearEphemeralExternalNode()
                  getNodeBridge().clearExternalNodeOverride()
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
                clearEphemeralExternalNode()
                getNodeBridge().clearExternalNodeOverride()
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
                    clearEphemeralExternalNode()
                    getNodeBridge().clearExternalNodeOverride()
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

        <SettingsSection title={t('Validation Rehearsal Devnet')}>
          <Stack spacing={4}>
            <Box>
              <Text fontWeight={500}>
                {t('Private multi-node rehearsal network')}
              </Text>
              <Text color="muted">
                {t(
                  'Start an isolated local Idena network for validation rehearsals without touching mainnet. The rehearsal network seeds FLIP-Challenge flips locally and lets the node run the normal encryption and later validation decryption flow.'
                )}
              </Text>
            </Box>

            <Stack
              spacing={3}
              borderWidth="1px"
              borderColor={devnetStatus.error ? 'red.100' : 'muted'}
              borderRadius="md"
              px={4}
              py={3}
              bg={devnetStatus.error ? 'red.50' : 'transparent'}
            >
              <Text fontWeight={500}>
                {devnetStatus.message ||
                  t('Validation rehearsal network is stopped.')}
              </Text>

              {devnetStatus.error && (
                <Text color="red.500">{devnetStatus.error}</Text>
              )}

              {rehearsalNeedsConnection && (
                <Stack spacing={1}>
                  <Text
                    color={rehearsalConnectWarning ? 'orange.500' : 'blue.500'}
                  >
                    {rehearsalConnectionMessage}
                  </Text>
                  {rehearsalCurrentNodeStatusNote && (
                    <Text color="muted">{rehearsalCurrentNodeStatusNote}</Text>
                  )}
                </Stack>
              )}

              {rehearsalSessionAlreadyAdvanced && (
                <Text color="orange.500">
                  {t(
                    'This rehearsal node is already inside {{period}}. Restart the rehearsal network for a clean short-session run.',
                    {period: rehearsalCurrentPeriod}
                  )}
                </Text>
              )}

              {(devnetStatus.networkId || devnetStatus.firstCeremonyAt) && (
                <Stack spacing={1}>
                  {devnetStatus.networkId && (
                    <Text color="muted">
                      {t('Network id')}: {devnetStatus.networkId}
                    </Text>
                  )}
                  {devnetStatus.firstCeremonyAt && (
                    <Text color="muted">
                      {t('First ceremony starts at')}:{' '}
                      {devnetStatus.firstCeremonyAt}
                    </Text>
                  )}
                  {typeof devnetStatus.countdownSeconds === 'number' && (
                    <Text color="muted">
                      {t('Countdown')}: {devnetStatus.countdownSeconds}
                      {t(' sec')}
                    </Text>
                  )}
                  {rehearsalCurrentPeriod && (
                    <Text color="muted">
                      {t('Primary node period')}: {rehearsalCurrentPeriod}
                    </Text>
                  )}
                  {devnetStatus.primaryRpcUrl && (
                    <Text color="muted">
                      {t('Primary RPC endpoint')}: {devnetStatus.primaryRpcUrl}
                    </Text>
                  )}
                  {devnetStatus.seedSource && (
                    <Text color="muted">
                      {t('Seed source')}: {devnetStatus.seedSource}
                    </Text>
                  )}
                  {typeof devnetStatus.seedSubmittedCount === 'number' && (
                    <Text color="muted">
                      {t('Seed flips')}: {devnetStatus.seedSubmittedCount}
                      {typeof devnetStatus.seedRequestedCount === 'number'
                        ? ` / ${devnetStatus.seedRequestedCount}`
                        : ''}
                    </Text>
                  )}
                  {typeof devnetStatus.seedConfirmedCount === 'number' && (
                    <Text color="muted">
                      {t('Confirmed flips on primary node')}:{' '}
                      {devnetStatus.seedConfirmedCount}
                    </Text>
                  )}
                  {typeof devnetStatus.primaryShortHashCount === 'number' && (
                    <Text color="muted">
                      {t('Assigned short-session flips on primary node')}:{' '}
                      {devnetStatus.primaryShortHashCount}
                      {typeof devnetStatus.primaryShortHashReadyCount ===
                      'number'
                        ? ` (${devnetStatus.primaryShortHashReadyCount} ready now)`
                        : ''}
                    </Text>
                  )}
                  {typeof devnetStatus.primaryLongHashCount === 'number' && (
                    <Text color="muted">
                      {t('Assigned long-session flips on primary node')}:{' '}
                      {devnetStatus.primaryLongHashCount}
                      {typeof devnetStatus.primaryLongHashReadyCount ===
                      'number'
                        ? ` (${devnetStatus.primaryLongHashReadyCount} ready now)`
                        : ''}
                    </Text>
                  )}
                  {devnetStatus.nodes.length > 0 && (
                    <Text color="muted">
                      {t('Ready nodes')}:{' '}
                      {
                        devnetStatus.nodes.filter(({rpcReady}) => rpcReady)
                          .length
                      }{' '}
                      / {devnetStatus.nodeCount}
                    </Text>
                  )}
                  {rehearsalNodeConnected && (
                    <Stack spacing={1}>
                      <Text color="green.500">
                        {t(
                          'IdenaAI is currently connected to the rehearsal network for this app session.'
                        )}
                      </Text>
                      {rehearsalSessionMessage && (
                        <Text
                          color={
                            rehearsalValidationOpenable
                              ? 'green.500'
                              : 'orange.500'
                          }
                        >
                          {rehearsalSessionMessage}
                        </Text>
                      )}
                    </Stack>
                  )}
                </Stack>
              )}

              <Stack isInline spacing={2} flexWrap="wrap">
                {!devnetStatus.active ? (
                  <>
                    <PrimaryButton
                      onClick={() => startRehearsalNetwork({connectApp: true})}
                      isLoading={isStartingDevnet}
                      isDisabled={!canUseIpcRenderer || isStartingDevnet}
                    >
                      {t('Start and use rehearsal network')}
                    </PrimaryButton>

                    <SecondaryButton
                      onClick={() => startRehearsalNetwork()}
                      isDisabled={!canUseIpcRenderer || isStartingDevnet}
                    >
                      {t('Start in background')}
                    </SecondaryButton>

                    <SecondaryButton
                      onClick={() =>
                        startRehearsalNetwork({
                          connectApp: true,
                          fastForward: true,
                        })
                      }
                      isDisabled={!canUseIpcRenderer || isStartingDevnet}
                    >
                      {t('Fast forward to session')}
                    </SecondaryButton>
                  </>
                ) : (
                  <>
                    {rehearsalCanOpenCountdown && (
                      <PrimaryButton
                        onClick={() =>
                          openValidationLottery(router, {
                            isRehearsalNodeSession: rehearsalNodeConnected,
                          })
                        }
                        isDisabled={!canUseIpcRenderer}
                      >
                        {t('Open countdown')}
                      </PrimaryButton>
                    )}

                    {rehearsalNodeConnected &&
                      rehearsalCurrentPeriod === 'ShortSession' &&
                      rehearsalValidationOpenable && (
                        <PrimaryButton
                          onClick={() => router.push('/validation')}
                          isDisabled={!canUseIpcRenderer}
                        >
                          {t('Open validation')}
                        </PrimaryButton>
                      )}

                    {rehearsalNodeConnected &&
                      rehearsalCurrentPeriod === 'LongSession' &&
                      rehearsalValidationOpenable && (
                        <PrimaryButton
                          onClick={() => router.push('/validation')}
                          isDisabled={!canUseIpcRenderer}
                        >
                          {t('Open validation')}
                        </PrimaryButton>
                      )}

                    {rehearsalNodeConnected &&
                      ['ShortSession', 'LongSession'].includes(
                        rehearsalCurrentPeriod
                      ) &&
                      !rehearsalValidationOpenable &&
                      rehearsalBlockedReason !== 'failed-rehearsal' && (
                        <PrimaryButton
                          onClick={() => {
                            const nextPath = getRehearsalValidationEntryPath({
                              blockedReason: rehearsalBlockedReason,
                              canOpenValidation: rehearsalValidationOpenable,
                            })

                            if (nextPath === '/validation/lottery') {
                              openValidationLottery(router, {
                                isRehearsalNodeSession: rehearsalNodeConnected,
                              })
                              return
                            }

                            router.push(nextPath)
                          }}
                          isDisabled={!canUseIpcRenderer}
                        >
                          {t('Open session status')}
                        </PrimaryButton>
                      )}

                    {rehearsalNodeConnected &&
                      rehearsalCurrentPeriod === 'AfterLongSession' && (
                        <PrimaryButton
                          onClick={() => router.push('/validation/after')}
                          isDisabled={!canUseIpcRenderer}
                        >
                          {t('Open results')}
                        </PrimaryButton>
                      )}

                    {rehearsalNeedsConnection && (
                      <PrimaryButton
                        onClick={() =>
                          getNodeBridge().connectValidationDevnet()
                        }
                        isDisabled={
                          !canUseIpcRenderer || !rehearsalNodeConnectable
                        }
                      >
                        {t('Use rehearsal node now')}
                      </PrimaryButton>
                    )}

                    <SecondaryButton
                      onClick={() =>
                        restartRehearsalNetwork({
                          connectApp:
                            rehearsalNodeConnected || rehearsalNeedsConnection,
                        })
                      }
                      isDisabled={!canUseIpcRenderer || isStartingDevnet}
                    >
                      {t('Restart fresh rehearsal')}
                    </SecondaryButton>

                    <SecondaryButton
                      onClick={() =>
                        restartRehearsalNetwork({
                          connectApp:
                            rehearsalNodeConnected || rehearsalNeedsConnection,
                          fastForward: true,
                        })
                      }
                      isDisabled={!canUseIpcRenderer || isStartingDevnet}
                    >
                      {t('Fast forward to session')}
                    </SecondaryButton>

                    <SecondaryButton
                      onClick={() => getNodeBridge().stopValidationDevnet()}
                      isDisabled={!canUseIpcRenderer || !devnetStatus.active}
                    >
                      {t('Stop rehearsal network')}
                    </SecondaryButton>
                  </>
                )}
              </Stack>
            </Stack>

            <Box>
              <Heading fontWeight={500} fontSize="md" mb={3}>
                {t('Rehearsal network log')}
              </Heading>
              <Flex
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
                {state.devnetLogs.length > 0 ? (
                  state.devnetLogs.map((log, idx) => (
                    <Ansi key={idx}>{log}</Ansi>
                  ))
                ) : (
                  <Text color="muted">{emptyDevnetLogMessage}</Text>
                )}
              </Flex>
            </Box>
          </Stack>
        </SettingsSection>

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
