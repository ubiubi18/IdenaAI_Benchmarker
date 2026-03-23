/* eslint-disable react/prop-types */
import React, {useMemo, useEffect, useState, useRef, useCallback} from 'react'
import {useMachine} from '@xstate/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {
  Flex,
  Text,
  IconButton,
  Heading,
  Stack,
  Button,
  Divider,
  SlideFade,
  useDisclosure,
  useToast,
} from '@chakra-ui/react'
import {createValidationMachine} from '../screens/validation/machine'
import {
  persistValidationState,
  loadValidationState,
  filterRegularFlips,
  rearrangeFlips,
  readyFlip,
  decodedWithKeywords,
  availableReportsNumber,
  solvableFlips,
} from '../screens/validation/utils'
import {
  ValidationScene,
  ActionBar,
  ThumbnailList,
  Header,
  Title,
  FlipChallenge,
  CurrentStep,
  Flip,
  ActionBarItem,
  Thumbnail,
  FlipWords,
  NavButton,
  QualificationActions,
  QualificationButton,
  WelcomeQualificationDialog,
  ValidationTimer,
  ValidationFailedDialog,
  SubmitFailedDialog,
  FailedFlipAnnotation,
  ReviewValidationDialog,
  EncourageReportDialog,
  BadFlipDialog,
  ReviewShortSessionDialog,
  SynchronizingValidationAlert,
  OfflineValidationAlert,
} from '../screens/validation/components'
import {rem} from '../shared/theme'
import {AnswerType, RelevanceType} from '../shared/types'
import {useEpochState} from '../shared/providers/epoch-context'
import {useTimingState} from '../shared/providers/timing-context'
import {
  InfoButton,
  PrimaryButton,
  SecondaryButton,
} from '../shared/components/button'
import {FloatDebug, Toast, Tooltip} from '../shared/components/components'
import {useChainState} from '../shared/providers/chain-context'
import {useSettingsState} from '../shared/providers/settings-context'
import {
  FullscreenIcon,
  HollowStarIcon,
  NewStarIcon,
} from '../shared/components/icons'
import {useAutoCloseValidationToast} from '../screens/validation/hooks/use-validation-toast'
import {solveShortSessionWithAi} from '../screens/validation/ai/solver-orchestrator'

const DEFAULT_AI_SOLVER_SETTINGS = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4o-mini',
  mode: 'manual',
  benchmarkProfile: 'strict',
  deadlineMs: 80 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 2,
  maxRetries: 1,
  maxOutputTokens: 120,
}

export default function ValidationPage() {
  const router = useRouter()
  const epoch = useEpochState()
  const timing = useTimingState()

  useAutoCloseValidationToast()

  const previewAi = router.query?.previewAi === '1'

  if (previewAi) {
    return (
      <ValidationSession
        epoch={999}
        validationStart={Date.now() + 60 * 1000}
        shortSessionDuration={80}
        longSessionDuration={180}
        forceAiPreview
      />
    )
  }

  if (epoch && timing && timing.shortSession)
    return (
      <ValidationSession
        epoch={epoch.epoch}
        validationStart={new Date(epoch.nextValidation).getTime()}
        shortSessionDuration={timing.shortSession}
        longSessionDuration={timing.longSession}
      />
    )

  return null
}

function ValidationSession({
  epoch,
  validationStart,
  shortSessionDuration,
  longSessionDuration,
  forceAiPreview = false,
}) {
  const router = useRouter()

  const {t, i18n} = useTranslation()
  const toast = useToast()
  const settings = useSettingsState()
  const aiSolverSettings = useMemo(
    () => ({
      ...DEFAULT_AI_SOLVER_SETTINGS,
      ...(settings.aiSolver || {}),
      ...(forceAiPreview ? {enabled: true} : {}),
    }),
    [forceAiPreview, settings.aiSolver]
  )
  const [aiSolving, setAiSolving] = useState(false)
  const [aiProgress, setAiProgress] = useState(null)
  const [aiLastRun, setAiLastRun] = useState(null)
  const autoSolveStartedRef = useRef(false)

  const {
    isOpen: isExceededTooltipOpen,
    onOpen: onOpenExceededTooltip,
    onClose: onCloseExceededTooltip,
  } = useDisclosure()
  const {
    isOpen: isReportDialogOpen,
    onOpen: onOpenReportDialog,
    onClose: onCloseReportDialog,
  } = useDisclosure()

  const validationMachine = useMemo(
    () =>
      createValidationMachine({
        epoch,
        validationStart,
        shortSessionDuration,
        longSessionDuration,
        locale: i18n.language || 'en',
      }),
    [
      epoch,
      i18n.language,
      longSessionDuration,
      shortSessionDuration,
      validationStart,
    ]
  )

  const [state, send] = useMachine(validationMachine, {
    actions: {
      onExceededReports: () => {
        onOpenExceededTooltip()
        setTimeout(onCloseExceededTooltip, 3000)
      },
      onValidationSucceeded: () => {
        router.push('/validation/after')
      },
    },
    state: loadValidationState(),
    logger: global.isDev
      ? console.log
      : (...args) => global.logger.debug(...args),
  })

  const {
    currentIndex,
    bestFlipHashes,
    translations,
    reports,
    longFlips,
    didReport,
  } = state.context

  useEffect(() => {
    persistValidationState(state)
  }, [state])

  const {
    isOpen: isOpenEncourageReportDialog,
    onOpen: onOpenEncourageReportDialog,
    onClose: onCloseEncourageReportDialog,
  } = useDisclosure()

  React.useEffect(() => {
    if (didReport) onOpenEncourageReportDialog()
  }, [didReport, onOpenEncourageReportDialog])

  const {syncing, offline} = useChainState()

  const flips = sessionFlips(state)
  const currentFlip = flips[currentIndex]

  const flipTimerDetails = {
    isShortSession: isShortSession(state),
    validationStart,
    shortSessionDuration,
    longSessionDuration,
  }

  const [bestRewardTipOpen, setBestRewardTipOpen] = useState(false)
  useEffect(() => {
    if (currentFlip && currentFlip.relevance === RelevanceType.Relevant) {
      setBestRewardTipOpen(true)
    }
  }, [currentFlip])
  useEffect(() => {
    if (bestFlipHashes[currentFlip?.hash]) {
      setBestRewardTipOpen(false)
    }
  }, [bestFlipHashes, currentFlip])
  useEffect(() => {
    if (bestRewardTipOpen) {
      setTimeout(() => {
        setBestRewardTipOpen(false)
      }, 5000)
    }
  }, [bestRewardTipOpen, currentFlip])

  const notifyAi = useCallback(
    (title, description, status = 'info') => {
      toast({
        render: () => (
          <Toast title={title} description={description} status={status} />
        ),
      })
    },
    [toast]
  )

  const canRunAiSolve =
    aiSolverSettings.enabled &&
    state.matches('shortSession.solve.answer.normal') &&
    state.matches('shortSession.fetch.done') &&
    !isSubmitting(state)

  const runAiSolve = useCallback(async () => {
    if (!canRunAiSolve || aiSolving) return

    setAiSolving(true)
    setAiProgress(t('Preparing flip payloads...'))
    setAiLastRun({
      status: 'running',
      provider: aiSolverSettings.provider,
      model: aiSolverSettings.model,
      startedAt: new Date().toISOString(),
    })

    try {
      const result = await solveShortSessionWithAi({
        shortFlips: state.context.shortFlips,
        aiSolver: aiSolverSettings,
        sessionMeta: {
          epoch,
          startedAt: new Date().toISOString(),
        },
        onProgress: ({index, total}) => {
          setAiProgress(
            t('Preparing flip payloads: {{current}}/{{total}}', {
              current: index,
              total,
            })
          )
        },
      })

      send({
        type: 'APPLY_AI_ANSWERS',
        answers: result.answers.map(({hash, option}) => ({hash, option})),
      })

      notifyAi(
        t('AI helper completed'),
        t('{{answers}} answers applied ({{provider}} {{model}})', {
          answers: result.answers.length,
          provider: result.provider,
          model: result.model,
        })
      )

      setAiLastRun({
        status: 'completed',
        provider: result.provider,
        model: result.model,
        profile: result.profile,
        summary: result.summary,
        flips: result.results || [],
        appliedAnswers: result.answers.length,
        completedAt: new Date().toISOString(),
      })

      if (result.answers.length > 0) {
        send('SUBMIT')
      }
    } catch (error) {
      const errorMessage = error?.message || error.toString()

      notifyAi(t('AI helper failed'), errorMessage, 'error')

      setAiLastRun((prev) => ({
        ...(prev || {}),
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      }))
    } finally {
      setAiSolving(false)
      setAiProgress(null)
    }
  }, [
    aiSolverSettings,
    aiSolving,
    canRunAiSolve,
    epoch,
    notifyAi,
    send,
    state.context.shortFlips,
    t,
  ])

  useEffect(() => {
    if (
      aiSolverSettings.enabled &&
      aiSolverSettings.mode === 'session-auto' &&
      canRunAiSolve &&
      !autoSolveStartedRef.current
    ) {
      autoSolveStartedRef.current = true
      runAiSolve()
    }
  }, [
    aiSolverSettings.enabled,
    aiSolverSettings.mode,
    canRunAiSolve,
    runAiSolve,
  ])

  useEffect(() => {
    if (!state.matches('shortSession')) {
      autoSolveStartedRef.current = false
    }
  }, [state])

  return (
    <ValidationScene bg={isShortSession(state) ? 'black' : 'white'}>
      {syncing && (
        <SynchronizingValidationAlert>
          {t('Synchronizing...')}
        </SynchronizingValidationAlert>
      )}

      {offline && (
        <OfflineValidationAlert>{t('Offline')}</OfflineValidationAlert>
      )}

      <Header>
        <Title color={isShortSession(state) ? 'white' : 'brandGray.500'}>
          {['shortSession', 'longSession'].some(state.matches) &&
          !isLongSessionKeywords(state)
            ? t('Select meaningful story: left or right', {nsSeparator: '!'})
            : t('Check flips quality')}
        </Title>
        <Flex align="center">
          <Title
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            mr={6}
          >
            {currentIndex + 1}{' '}
            <Text as="span" color="muted">
              {t('out of')} {flips.length}
            </Text>
          </Title>

          <IconButton
            icon={<FullscreenIcon />}
            bg={isShortSession(state) ? 'brandGray.060' : 'gray.300'}
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            borderRadius="lg"
            fontSize={rem(20)}
            w={10}
            h={10}
            _hover={{
              bg: isShortSession(state) ? 'brandGray.060' : 'gray.300',
            }}
            onClick={global.toggleFullScreen}
          />
        </Flex>
      </Header>
      <CurrentStep>
        <FlipChallenge>
          <Flex justify="center" align="center" position="relative">
            {currentFlip &&
              ((currentFlip.fetched && !currentFlip.decoded) ||
                currentFlip.failed) && (
                <FailedFlipAnnotation>
                  {t('No data available. Please skip the flip.')}
                </FailedFlipAnnotation>
              )}
            <Flip
              {...currentFlip}
              variant={AnswerType.Left}
              timerDetails={flipTimerDetails}
              onChoose={(hash) =>
                send({
                  type: 'ANSWER',
                  hash,
                  option: AnswerType.Left,
                })
              }
            />
            <Flip
              {...currentFlip}
              variant={AnswerType.Right}
              timerDetails={flipTimerDetails}
              onChoose={(hash) =>
                send({
                  type: 'ANSWER',
                  hash,
                  option: AnswerType.Right,
                })
              }
              onImageFail={() => send('REFETCH_FLIPS')}
            />
          </Flex>
          {(isLongSessionKeywords(state) ||
            state.matches('validationSucceeded')) &&
            currentFlip && (
              <FlipWords
                key={currentFlip.hash}
                currentFlip={currentFlip}
                translations={translations}
                validationStart={validationStart}
                onSkip={() => {
                  if (isLastFlip(state)) {
                    send({type: 'SUBMIT'})
                  } else {
                    send({type: 'NEXT'})
                  }
                }}
              >
                <Stack spacing={4}>
                  <Stack isInline spacing={1} align="center">
                    <Heading fontSize="base" fontWeight={500}>
                      {t(`Is the flip correct?`)}
                    </Heading>
                    <InfoButton onClick={onOpenReportDialog} />
                  </Stack>
                  <QualificationActions>
                    <QualificationButton
                      isSelected={
                        currentFlip.relevance === RelevanceType.Relevant
                      }
                      onClick={() => {
                        onCloseExceededTooltip()
                        send({
                          type: 'APPROVE_WORDS',
                          hash: currentFlip.hash,
                        })
                      }}
                    >
                      {t('Approve')}
                    </QualificationButton>

                    <Tooltip
                      label={t(
                        'All available reports are used. You can skip this flip or remove Report status from other flips.'
                      )}
                      isOpen={isExceededTooltipOpen}
                      placement="top"
                      zIndex="tooltip"
                    >
                      <QualificationButton
                        isSelected={
                          currentFlip.relevance === RelevanceType.Irrelevant
                        }
                        bg={
                          currentFlip.relevance === RelevanceType.Irrelevant
                            ? 'red.500'
                            : 'red.012'
                        }
                        color={
                          currentFlip.relevance === RelevanceType.Irrelevant
                            ? 'white'
                            : 'red.500'
                        }
                        _hover={null}
                        _active={null}
                        _focus={{
                          boxShadow: '0 0 0 3px rgb(255 102 102 /0.50)',
                          outline: 'none',
                        }}
                        onClick={() =>
                          send({
                            type: 'REPORT_WORDS',
                            hash: currentFlip.hash,
                          })
                        }
                      >
                        {t('Report')}{' '}
                        {t('({{count}} left)', {
                          count:
                            availableReportsNumber(longFlips) - reports.size,
                        })}
                      </QualificationButton>
                    </Tooltip>
                  </QualificationActions>
                  <SlideFade
                    style={{
                      zIndex:
                        currentFlip.relevance === RelevanceType.Relevant &&
                        (Object.keys(bestFlipHashes).length < 1 ||
                          bestFlipHashes[currentFlip.hash])
                          ? 'auto'
                          : -1,
                    }}
                    offsetY="-80px"
                    in={
                      currentFlip.relevance === RelevanceType.Relevant &&
                      (Object.keys(bestFlipHashes).length < 1 ||
                        bestFlipHashes[currentFlip.hash])
                    }
                  >
                    <Divider mt={1} />
                    <Flex direction="column" align="center">
                      <Button
                        backgroundColor="transparent"
                        border="solid 1px #d2d4d9"
                        color="brandGray.500"
                        borderRadius={6}
                        mt={5}
                        variant="bordered"
                        w={['100%', 'auto']}
                        isActive={!!bestFlipHashes[currentFlip.hash]}
                        _hover={{
                          backgroundColor: 'transparent',
                          _disabled: {
                            backgroundColor: 'transparent',
                            color: '#DCDEDF',
                          },
                        }}
                        _active={{
                          backgroundColor: '#F5F6F7',
                        }}
                        onClick={() =>
                          send({
                            type: 'FAVORITE',
                            hash: currentFlip.hash,
                          })
                        }
                      >
                        {bestFlipHashes[currentFlip.hash] ? (
                          <NewStarIcon
                            h="12.5px"
                            w="13px"
                            mr="5.5px"
                            fill="brandGray.500"
                          />
                        ) : (
                          <HollowStarIcon
                            h="12.5px"
                            w="13px"
                            mr="5.5px"
                            fill="brandGray.500"
                          />
                        )}
                        {t('Mark as the best')}
                      </Button>
                      <Text fontSize="11px" color="#B8BABC" mt={2}>
                        {t('You can mark this flip as the best')}
                      </Text>
                    </Flex>
                  </SlideFade>
                </Stack>
              </FlipWords>
            )}
        </FlipChallenge>
      </CurrentStep>
      {isShortSession(state) && aiSolverSettings.enabled && (
        <AiTelemetryPanel
          isShortSessionMode={isShortSession(state)}
          telemetry={aiLastRun}
          aiProgress={aiProgress}
        />
      )}
      <ActionBar>
        <ActionBarItem />
        <ActionBarItem justify="center">
          <ValidationTimer
            validationStart={validationStart}
            duration={
              shortSessionDuration -
              10 +
              (isShortSession(state) ? 0 : longSessionDuration)
            }
          />
        </ActionBarItem>
        <ActionBarItem justify="flex-end">
          {isShortSession(state) && aiSolverSettings.enabled && (
            <Stack isInline spacing={2} align="center" mr={3}>
              {aiProgress && (
                <Text
                  fontSize="xs"
                  color={isShortSession(state) ? 'whiteAlpha.800' : 'muted'}
                >
                  {aiProgress}
                </Text>
              )}
              <SecondaryButton
                isDisabled={!canRunAiSolve}
                isLoading={aiSolving}
                onClick={runAiSolve}
              >
                {t('AI solve short session')}
              </SecondaryButton>
            </Stack>
          )}
          {(isShortSession(state) || isLongSessionKeywords(state)) &&
            (hasAllRelevanceMarks(state) || isLastFlip(state) ? (
              <PrimaryButton
                isDisabled={!canSubmit(state)}
                isLoading={isSubmitting(state)}
                loadingText={t('Submitting answers...')}
                onClick={() => send('SUBMIT')}
              >
                {t('Submit answers')}
              </PrimaryButton>
            ) : (
              <Tooltip label={t('Go to last flip')}>
                <PrimaryButton
                  isDisabled={!canSubmit(state)}
                  isLoading={isSubmitting(state)}
                  loadingText={t('Submitting answers...')}
                  onClick={() => send('SUBMIT')}
                >
                  {t('Submit answers')}
                </PrimaryButton>
              </Tooltip>
            ))}
          {isLongSessionFlips(state) && (
            <PrimaryButton
              isDisabled={!canSubmit(state)}
              onClick={() => send('FINISH_FLIPS')}
            >
              {t('Start checking keywords')}
            </PrimaryButton>
          )}
        </ActionBarItem>
      </ActionBar>

      <ThumbnailList currentIndex={currentIndex}>
        {flips.map((flip, idx) => (
          <Thumbnail
            key={flip.hash}
            {...flip}
            isCurrent={currentIndex === idx}
            isBest={bestFlipHashes[flip.hash]}
            onPick={() => send({type: 'PICK', index: idx})}
          />
        ))}
      </ThumbnailList>

      {!isFirstFlip(state) &&
        hasManyFlips(state) &&
        isSolving(state) &&
        !isSubmitting(state) && (
          <NavButton
            type="prev"
            bg={isShortSession(state) ? 'xwhite.010' : 'gray.50'}
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            onClick={() => send({type: 'PREV'})}
          />
        )}
      {!isLastFlip(state) &&
        hasManyFlips(state) &&
        isSolving(state) &&
        !isSubmitting(state) && (
          <NavButton
            type="next"
            bg={isShortSession(state) ? 'xwhite.010' : 'gray.50'}
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            onClick={() => send({type: 'NEXT'})}
          />
        )}
      {isSubmitFailed(state) && (
        <SubmitFailedDialog isOpen onSubmit={() => send('RETRY_SUBMIT')} />
      )}

      {state.matches('longSession.solve.answer.welcomeQualification') && (
        <WelcomeQualificationDialog
          isOpen
          onSubmit={() => send('START_LONG_SESSION')}
        />
      )}

      {state.matches('validationFailed') && (
        <ValidationFailedDialog isOpen onSubmit={() => router.push('/home')} />
      )}

      <BadFlipDialog
        isOpen={
          isReportDialogOpen ||
          state.matches('longSession.solve.answer.finishFlips')
        }
        title={t('Earn rewards for reporting')}
        subtitle={t(
          'Report bad flips and get rewarded if these flips are reported by more than 50% of other participants'
        )}
        onClose={() => {
          if (state.matches('longSession.solve.answer.finishFlips'))
            send('START_KEYWORDS_QUALIFICATION')
          else onCloseReportDialog()
        }}
      />

      <ReviewValidationDialog
        flips={flips.filter(solvableFlips)}
        reportedFlipsCount={reports.size}
        availableReportsCount={availableReportsNumber(longFlips)}
        isOpen={state.matches('longSession.solve.answer.review')}
        isSubmitting={isSubmitting(state)}
        onSubmit={() => send('SUBMIT')}
        onMisingAnswers={() => {
          send({
            type: 'CHECK_FLIPS',
            index: flips.findIndex(({option = 0}) => option < 1),
          })
        }}
        onMisingReports={() => {
          send('CHECK_REPORTS')
        }}
        onCancel={() => {
          send('CANCEL')
        }}
      />

      <ReviewShortSessionDialog
        flips={flips.filter(solvableFlips)}
        isOpen={state.matches(
          'shortSession.solve.answer.submitShortSession.confirm'
        )}
        onSubmit={() => send('SUBMIT')}
        onClose={() => {
          send('CANCEL')
        }}
        onCancel={() => {
          send('CANCEL')
        }}
      />

      <EncourageReportDialog
        isOpen={isOpenEncourageReportDialog}
        onClose={onCloseEncourageReportDialog}
      />

      {global.isDev && <FloatDebug>{state.value}</FloatDebug>}
    </ValidationScene>
  )
}

function toPct(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0%'
  return `${Math.round(Math.max(0, Math.min(1, num)) * 100)}%`
}

function formatLatency(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return '-'
  return `${num}ms`
}

function shortenHash(hash) {
  const value = String(hash || '')
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function AiTelemetryPanel({isShortSessionMode, telemetry, aiProgress}) {
  const cardBg = isShortSessionMode ? 'whiteAlpha.100' : 'gray.50'
  const cardBorder = isShortSessionMode ? 'whiteAlpha.300' : 'gray.100'
  const titleColor = isShortSessionMode ? 'whiteAlpha.900' : 'brandGray.500'
  const bodyColor = isShortSessionMode ? 'whiteAlpha.800' : 'muted'

  return (
    <Stack
      spacing={2}
      px={4}
      py={3}
      mx={6}
      mb={3}
      borderWidth="1px"
      borderColor={cardBorder}
      borderRadius="md"
      bg={cardBg}
    >
      <Text fontSize="xs" fontWeight={600} color={titleColor}>
        AI benchmark telemetry
      </Text>

      {aiProgress && (
        <Text fontSize="xs" color={bodyColor}>
          {aiProgress}
        </Text>
      )}

      {!telemetry && (
        <Text fontSize="xs" color={bodyColor}>
          No AI run yet in this validation session.
        </Text>
      )}

      {telemetry && (
        <Stack spacing={1}>
          <Text fontSize="xs" color={bodyColor}>
            {`${telemetry.provider || '-'} ${telemetry.model || '-'}`}
          </Text>

          {telemetry.status === 'running' && (
            <Text fontSize="xs" color={bodyColor}>
              Preparing and solving flips...
            </Text>
          )}

          {telemetry.status === 'failed' && (
            <Text fontSize="xs" color="red.300">
              {telemetry.error || 'AI run failed'}
            </Text>
          )}

          {telemetry.summary && (
            <Text fontSize="xs" color={bodyColor}>
              {`applied ${telemetry.appliedAnswers || 0}, left ${
                telemetry.summary.left || 0
              }, right ${telemetry.summary.right || 0}, skipped ${
                telemetry.summary.skipped || 0
              }, elapsed ${formatLatency(telemetry.summary.elapsedMs)}`}
            </Text>
          )}

          {Array.isArray(telemetry.flips) &&
            telemetry.flips.slice(0, 6).map((flip) => (
              <Flex key={flip.hash} justify="space-between" gap={3}>
                <Text fontSize="xs" color={bodyColor} noOfLines={1}>
                  {`${shortenHash(flip.hash)} ${String(
                    flip.answer || 'skip'
                  ).toUpperCase()}`}
                </Text>
                <Text fontSize="xs" color={bodyColor}>
                  {`${toPct(flip.confidence)} ${formatLatency(flip.latencyMs)}${
                    flip.error ? ' ERR' : ''
                  }`}
                </Text>
              </Flex>
            ))}
        </Stack>
      )}
    </Stack>
  )
}

function isShortSession(state) {
  return state.matches('shortSession')
}

function isLongSessionFlips(state) {
  return ['flips', 'finishFlips']
    .map((substate) => `longSession.solve.answer.${substate}`)
    .some(state.matches)
}

function isLongSessionKeywords(state) {
  return ['keywords', 'submitLongSession']
    .map((substate) => `longSession.solve.answer.${substate}`)
    .some(state.matches)
}

function isSolving(state) {
  return ['shortSession', 'longSession'].some(state.matches)
}

function isSubmitting(state) {
  return [
    'shortSession.solve.answer.submitShortSession.submitting',
    'longSession.solve.answer.finishFlips',
    'longSession.solve.answer.submitLongSession',
  ].some(state.matches)
}

function isSubmitFailed(state) {
  return [
    ['shortSession', 'submitShortSession'],
    ['longSession', 'submitLongSession'],
  ]
    .map(([state1, state2]) => `${state1}.solve.answer.${state2}.fail`)
    .some(state.matches)
}

function isFirstFlip(state) {
  return ['shortSession', 'longSession']
    .map((substate) => `${substate}.solve.nav.firstFlip`)
    .some(state.matches)
}

function isLastFlip(state) {
  return ['shortSession', 'longSession']
    .map((type) => `${type}.solve.nav.lastFlip`)
    .some(state.matches)
}

function hasManyFlips(state) {
  return sessionFlips(state).length > 1
}

function canSubmit(state) {
  if (isShortSession(state) || isLongSessionFlips(state))
    return (hasAllAnswers(state) || isLastFlip(state)) && !isSubmitting(state)

  if (isLongSessionKeywords(state))
    return (
      (hasAllRelevanceMarks(state) || isLastFlip(state)) && !isSubmitting(state)
    )
}

function sessionFlips(state) {
  const {
    context: {shortFlips, longFlips},
  } = state
  return isShortSession(state)
    ? rearrangeFlips(filterRegularFlips(shortFlips))
    : rearrangeFlips(longFlips.filter(readyFlip))
}

function hasAllAnswers(state) {
  const {
    context: {shortFlips, longFlips},
  } = state
  const flips = isShortSession(state)
    ? shortFlips.filter(({decoded, extra}) => decoded && !extra)
    : longFlips.filter(({decoded}) => decoded)
  return flips.length && flips.every(({option}) => option)
}

function hasAllRelevanceMarks({context: {longFlips}}) {
  const flips = longFlips.filter(decodedWithKeywords)
  return flips.every(({relevance}) => relevance)
}
