/* eslint-disable react/prop-types */
import {
  Box,
  Button,
  Center,
  CloseButton,
  Flex,
  Heading,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react'
import dayjs from 'dayjs'
import NextLink from 'next/link'
import {useRouter} from 'next/router'
import React from 'react'
import {useTranslation} from 'react-i18next'
import {useTrackTx} from '../../screens/ads/hooks'
import {ValidationCountdown} from '../../screens/validation/components/countdown'
import {usePersistedValidationState} from '../../screens/validation/hooks/use-persisted-state'
import {
  useAutoCloseValidationToast,
  useTrackEpochPeriod,
} from '../../screens/validation/hooks/use-validation-toast'
import {
  buildValidationIdentityScope,
  buildValidationSessionNodeScope,
  buildValidationSessionScopeKey,
  canOpenValidationCeremonyLocalResults,
  canValidate,
  hasSubmittedLongSessionAnswers,
} from '../../screens/validation/utils'
import {
  computeRehearsalBenchmarkSummary,
  countReviewedRehearsalBenchmarkItems,
  getRehearsalBenchmarkAuditStatus,
  loadRehearsalBenchmarkReview,
  normalizeRehearsalBenchmarkReviewState,
  persistRehearsalBenchmarkReview,
} from '../../screens/validation/rehearsal-benchmark'
import {
  computeValidationAiCostBreakdown,
  computeValidationAiCostTotals,
  loadValidationAiCostLedger,
} from '../../screens/validation/ai-cost-tracker'
import {ErrorAlert} from '../../shared/components/components'
import {Status} from '../../shared/components/sidebar'
import {useEpochState} from '../../shared/providers/epoch-context'
import {useIdentity} from '../../shared/providers/identity-context'
import {
  isValidationRehearsalNodeSettings,
  useSettingsState,
} from '../../shared/providers/settings-context'
import {useTimingState} from '../../shared/providers/timing-context'
import {useChainState} from '../../shared/providers/chain-context'
import {EpochPeriod, IdentityStatus} from '../../shared/types'
import {HASH_IN_MEMPOOL} from '../../shared/utils/utils'

export default function AfterValidationPage() {
  const {t} = useTranslation()

  const router = useRouter()

  const settings = useSettingsState()
  const [identity] = useIdentity()
  const {loading, offline, syncing} = useChainState()
  const isRehearsalNodeSession = isValidationRehearsalNodeSettings(settings)

  const validationIdentityScope = React.useMemo(
    () =>
      buildValidationIdentityScope({
        address: identity?.address,
        nodeScope: buildValidationSessionNodeScope({
          runInternalNode: settings.runInternalNode,
          useExternalNode: settings.useExternalNode,
          url: settings.url,
          internalPort: settings.internalPort,
        }),
      }),
    [
      identity?.address,
      settings.internalPort,
      settings.runInternalNode,
      settings.url,
      settings.useExternalNode,
    ]
  )

  const {data: validationState} = usePersistedValidationState({
    scope: validationIdentityScope,
    live: true,
  })
  const rehearsalBenchmarkSummary = React.useMemo(
    () => computeRehearsalBenchmarkSummary(validationState),
    [validationState]
  )
  const rehearsalBenchmarkReviewScope = React.useMemo(
    () => ({
      epoch: validationState?.context?.epoch,
      address: identity?.address,
      nodeScope: buildValidationSessionNodeScope({
        runInternalNode: settings.runInternalNode,
        useExternalNode: settings.useExternalNode,
        url: settings.url,
        internalPort: settings.internalPort,
      }),
      validationStart: validationState?.context?.validationStart,
    }),
    [
      identity?.address,
      settings.internalPort,
      settings.runInternalNode,
      settings.url,
      settings.useExternalNode,
      validationState?.context?.epoch,
      validationState?.context?.validationStart,
    ]
  )
  const [rehearsalBenchmarkReviewState, setRehearsalBenchmarkReviewState] =
    React.useState(() =>
      loadRehearsalBenchmarkReview(rehearsalBenchmarkReviewScope)
    )
  const [validationAiCostLedger, setValidationAiCostLedger] = React.useState(
    () => loadValidationAiCostLedger(rehearsalBenchmarkReviewScope)
  )

  React.useEffect(() => {
    setRehearsalBenchmarkReviewState(
      loadRehearsalBenchmarkReview(rehearsalBenchmarkReviewScope)
    )
  }, [rehearsalBenchmarkReviewScope])

  React.useEffect(() => {
    setValidationAiCostLedger(
      loadValidationAiCostLedger(rehearsalBenchmarkReviewScope)
    )
  }, [rehearsalBenchmarkReviewScope])

  const reviewedBenchmarkCount = React.useMemo(
    () =>
      countReviewedRehearsalBenchmarkItems(
        rehearsalBenchmarkReviewState,
        rehearsalBenchmarkSummary.items
      ),
    [rehearsalBenchmarkReviewState, rehearsalBenchmarkSummary.items]
  )
  const benchmarkAuditStatus = React.useMemo(
    () =>
      getRehearsalBenchmarkAuditStatus(
        rehearsalBenchmarkReviewState,
        rehearsalBenchmarkSummary.items
      ),
    [rehearsalBenchmarkReviewState, rehearsalBenchmarkSummary.items]
  )
  const validationAiCostTotals = React.useMemo(
    () => computeValidationAiCostTotals(validationAiCostLedger),
    [validationAiCostLedger]
  )
  const validationAiCostBreakdown = React.useMemo(
    () => computeValidationAiCostBreakdown(validationAiCostLedger),
    [validationAiCostLedger]
  )
  const submitLongAnswersHash = String(
    validationState?.context?.submitLongAnswersHash || ''
  ).trim()
  const {data: submitLongAnswersTx} = useTrackTx(submitLongAnswersHash)
  const hasSubmittedLongAnswers = React.useMemo(
    () => hasSubmittedLongSessionAnswers(validationState),
    [validationState]
  )
  const isLongSubmitPending = React.useMemo(() => {
    if (!submitLongAnswersHash) {
      return false
    }

    if (!submitLongAnswersTx?.blockHash) {
      return true
    }

    return submitLongAnswersTx.blockHash === HASH_IN_MEMPOOL
  }, [submitLongAnswersHash, submitLongAnswersTx?.blockHash])
  const canOpenLocalResultsDuringCeremony = React.useMemo(
    () => canOpenValidationCeremonyLocalResults(validationState),
    [validationState]
  )

  const epoch = useEpochState()
  const currentPeriod = epoch?.currentPeriod

  const isAfterLongSession = currentPeriod === EpochPeriod.AfterLongSession
  const isLongSession = currentPeriod === EpochPeriod.LongSession
  const isValidationCeremony = [
    EpochPeriod.ShortSession,
    EpochPeriod.LongSession,
  ].includes(currentPeriod)
  const longSessionStatusMessage = React.useMemo(() => {
    if (!isLongSession || !canOpenLocalResultsDuringCeremony) {
      return ''
    }

    if (!hasSubmittedLongAnswers) {
      return t(
        'Long-session countdown is still running. Local stats and benchmark audit are already available now, and you can return to validation any time to keep reporting or submit answers.'
      )
    }

    if (isLongSubmitPending) {
      return t(
        'Your long-session answers are being submitted. Local stats and benchmark audit are already available while the countdown continues.'
      )
    }

    return t(
      'Your long-session answers are submitted. Local stats and benchmark audit are already available while the countdown continues.'
    )
  }, [
    canOpenLocalResultsDuringCeremony,
    hasSubmittedLongAnswers,
    isLongSession,
    isLongSubmitPending,
    t,
  ])
  const returnToValidationLabel = React.useMemo(
    () =>
      hasSubmittedLongAnswers
        ? t('Back to validation countdown')
        : t('Return to validation'),
    [hasSubmittedLongAnswers, t]
  )
  const pageHeading = React.useMemo(() => {
    if (isAfterLongSession) {
      return t('Waiting for the Idena validation results')
    }

    if (canOpenLocalResultsDuringCeremony) {
      return t('Local validation results are ready')
    }

    return t('Waiting for the end of the long session')
  }, [canOpenLocalResultsDuringCeremony, isAfterLongSession, t])

  const timing = useTimingState()

  const isEligible = canValidate(identity, {isRehearsalNodeSession})
  const showEligibilityError =
    !isEligible &&
    !loading &&
    !offline &&
    !syncing &&
    !identity.fetchingIdentity

  const isValidated = [
    IdentityStatus.Newbie,
    IdentityStatus.Verified,
    IdentityStatus.Human,
  ].includes(identity.state)

  const validationEnd = dayjs(epoch?.nextValidation)
    .add(timing?.shortSession, 'second')
    .add(timing?.longSession, 'second')

  const rehearsalBenchmarkReviewRoute = React.useMemo(() => {
    const reviewScopeKey = buildValidationSessionScopeKey(
      rehearsalBenchmarkReviewScope
    )

    return reviewScopeKey
      ? `/validation/review?scope=${encodeURIComponent(reviewScopeKey)}`
      : '/validation/review'
  }, [rehearsalBenchmarkReviewScope])

  const skipRehearsalBenchmarkAudit = React.useCallback(() => {
    const nextState = normalizeRehearsalBenchmarkReviewState({
      ...rehearsalBenchmarkReviewState,
      auditStatus: 'skipped',
    })

    setRehearsalBenchmarkReviewState(nextState)
    persistRehearsalBenchmarkReview(rehearsalBenchmarkReviewScope, nextState)
  }, [rehearsalBenchmarkReviewScope, rehearsalBenchmarkReviewState])

  const benchmarkAuditSummary = React.useMemo(() => {
    switch (benchmarkAuditStatus) {
      case 'completed':
        return t(
          'Manual audit completed for this rehearsal run. You can reopen it any time to adjust notes or compare individual flips again.'
        )
      case 'in_progress':
        return t(
          'Manual audit is in progress for this rehearsal run. Continue annotating benchmark quality or skip and return later.'
        )
      case 'skipped':
        return t(
          'Manual audit is optional and has been skipped for this rehearsal run. You can reopen it later whenever you want to inspect the results.'
        )
      default:
        return t(
          'Manual audit is optional for this rehearsal run. Use it to check benchmark labels and report choices, or skip it with one click and come back later.'
        )
    }
  }, [benchmarkAuditStatus, t])

  const benchmarkAuditActionLabel = React.useMemo(() => {
    switch (benchmarkAuditStatus) {
      case 'completed':
        return t('Reopen audit')
      case 'in_progress':
        return t('Continue audit')
      case 'skipped':
        return t('Audit later')
      default:
        return t('Audit benchmark flips')
    }
  }, [benchmarkAuditStatus, t])

  useAutoCloseValidationToast()

  useTrackEpochPeriod({
    onChangeCurrentPeriod: (period) => {
      if ([EpochPeriod.None, EpochPeriod.FlipLottery].includes(period)) {
        router.push('/home')
      }
    },
  })

  return (
    <Box
      bg="graphite.500"
      color="white"
      fontSize="md"
      p={['8', 0]}
      pt={['2', 0]}
      position="relative"
      w="full"
    >
      <Flex
        justifyContent="space-between"
        alignItems="center"
        position={['relative', 'absolute']}
        insetX={[0, '4']}
        top={[null, '2']}
        mx={['-4', 0]}
        mb={['8', 0]}
      >
        <Status />
        <NextLink href="/home" passHref>
          <CloseButton boxSize={4} color="white" />
        </NextLink>
      </Flex>

      <Center color="white" minH="100vh">
        <Stack spacing="12" w={['xs', '640px']}>
          <Stack spacing="6">
            <Stack spacing="2">
              <Heading fontSize="lg" fontWeight={500}>
                {pageHeading}
              </Heading>

              {isAfterLongSession && (
                <Text color="xwhite.050" fontSize="mdx">
                  {t('Network is reaching consensus on validated identities')}
                </Text>
              )}

              {isLongSession && canOpenLocalResultsDuringCeremony && (
                <Text color="xwhite.050" fontSize="mdx">
                  {longSessionStatusMessage}
                </Text>
              )}

              {isValidationCeremony &&
                !isAfterLongSession &&
                !canOpenLocalResultsDuringCeremony && (
                  <Text color="xwhite.050" fontSize="mdx">
                    {isEligible &&
                      isLongSubmitPending &&
                      t('Please wait. Your answers are being submitted...')}
                    {isEligible &&
                      !isLongSubmitPending &&
                      t('Your answers are successfully submitted')}
                  </Text>
                )}
            </Stack>
            {isLongSession && canOpenLocalResultsDuringCeremony && (
              <Stack direction={['column', 'row']} spacing="3">
                <Button
                  alignSelf="flex-start"
                  onClick={() => router.push('/validation')}
                >
                  {returnToValidationLabel}
                </Button>
              </Stack>
            )}
            {isAfterLongSession ? null : (
              <ValidationCountdown duration={validationEnd.diff(dayjs())} />
            )}

            {showEligibilityError && (
              <ErrorAlert>
                {isValidated
                  ? t(
                      'Can not start validation session because you did not submit flips'
                    )
                  : t(
                      'Can not start validation session because you did not activate invite'
                    )}
              </ErrorAlert>
            )}

            {rehearsalBenchmarkSummary.available && (
              <Box
                borderWidth="1px"
                borderColor="whiteAlpha.300"
                bg="whiteAlpha.100"
                borderRadius="lg"
                px="5"
                py="4"
              >
                <Stack spacing="4">
                  <Box>
                    <Heading fontSize="md" fontWeight={500}>
                      {t('Optional rehearsal audit')}
                    </Heading>
                    <Text color="xwhite.050" fontSize="sm">
                      {t(rehearsalBenchmarkSummary.note)}
                    </Text>
                    <Text color="xwhite.050" fontSize="sm" mt="2">
                      {benchmarkAuditSummary}
                    </Text>
                  </Box>

                  <SimpleGrid columns={[2, 4]} spacing="3">
                    <BenchmarkStat
                      label={t('Correct')}
                      value={`${rehearsalBenchmarkSummary.correct}/${rehearsalBenchmarkSummary.total}`}
                    />
                    <BenchmarkStat
                      label={t('Accuracy')}
                      value={
                        rehearsalBenchmarkSummary.accuracy !== null
                          ? `${(
                              rehearsalBenchmarkSummary.accuracy * 100
                            ).toFixed(1)}%`
                          : '–'
                      }
                    />
                    <BenchmarkStat
                      label={t('Answered')}
                      value={`${rehearsalBenchmarkSummary.answered}/${rehearsalBenchmarkSummary.total}`}
                    />
                    <BenchmarkStat
                      label={t('Reports')}
                      value={String(rehearsalBenchmarkSummary.reported)}
                    />
                  </SimpleGrid>

                  <Text color="xwhite.050" fontSize="sm">
                    {t(
                      'Short: {{shortCorrect}}/{{shortTotal}} correct. Long: {{longCorrect}}/{{longTotal}} correct. Manual review: {{reviewed}}/{{total}} flips.',
                      {
                        shortCorrect:
                          rehearsalBenchmarkSummary.sessions.short.correct,
                        shortTotal:
                          rehearsalBenchmarkSummary.sessions.short.total,
                        longCorrect:
                          rehearsalBenchmarkSummary.sessions.long.correct,
                        longTotal:
                          rehearsalBenchmarkSummary.sessions.long.total,
                        reviewed: reviewedBenchmarkCount,
                        total: rehearsalBenchmarkSummary.total,
                      }
                    )}
                  </Text>
                  <Text color="xwhite.050" fontSize="sm">
                    {rehearsalBenchmarkSummary.rawConsensusAvailable
                      ? t(
                          'Consensus-backed subset: {{correct}}/{{total}} correct ({{coverage}} coverage of the rehearsal benchmark set).',
                          {
                            correct:
                              rehearsalBenchmarkSummary.consensusBacked.correct,
                            total:
                              rehearsalBenchmarkSummary.consensusBacked.total,
                            coverage:
                              rehearsalBenchmarkSummary.consensusBacked
                                .coverage !== null
                                ? `${(
                                    rehearsalBenchmarkSummary.consensusBacked
                                      .coverage * 100
                                  ).toFixed(1)}%`
                                : '–',
                          }
                        )
                      : t(
                          'Raw vote counts were not bundled for this local rehearsal slice, so the benchmark currently uses agreed-answer labels only.'
                        )}
                  </Text>

                  <Stack direction={['column', 'row']} spacing="3">
                    <Button
                      alignSelf="flex-start"
                      onClick={() => router.push(rehearsalBenchmarkReviewRoute)}
                    >
                      {benchmarkAuditActionLabel}
                    </Button>
                    {benchmarkAuditStatus !== 'completed' &&
                    benchmarkAuditStatus !== 'skipped' ? (
                      <Button
                        variant="ghost"
                        alignSelf="flex-start"
                        onClick={skipRehearsalBenchmarkAudit}
                      >
                        {t('Skip audit for now')}
                      </Button>
                    ) : null}
                  </Stack>
                </Stack>
              </Box>
            )}

            {validationAiCostTotals.count > 0 && (
              <Box
                borderWidth="1px"
                borderColor="whiteAlpha.300"
                bg="whiteAlpha.100"
                borderRadius="lg"
                px="5"
                py="4"
              >
                <Stack spacing="4">
                  <Box>
                    <Heading fontSize="md" fontWeight={500}>
                      {t('Validation AI cost tracker')}
                    </Heading>
                    <Text color="xwhite.050" fontSize="sm">
                      {t(
                        'Tracks AI token usage for this validation run across solve and automatic report-review steps.'
                      )}
                    </Text>
                  </Box>

                  <SimpleGrid columns={[2, 4]} spacing="3">
                    <BenchmarkStat
                      label={t('Actions')}
                      value={String(validationAiCostTotals.count)}
                    />
                    <BenchmarkStat
                      label={t('Tokens')}
                      value={formatTokenCount(
                        validationAiCostTotals.totalTokens
                      )}
                    />
                    <BenchmarkStat
                      label={t('Estimated')}
                      value={formatUsd(validationAiCostTotals.estimatedUsd)}
                    />
                    <BenchmarkStat
                      label={t('Actual')}
                      value={formatUsd(validationAiCostTotals.actualUsd)}
                    />
                  </SimpleGrid>

                  <SimpleGrid columns={[1, 2]} spacing="3">
                    <ValidationAiCostBreakdownCard
                      label={t('Short session')}
                      totals={validationAiCostBreakdown.short}
                    />
                    <ValidationAiCostBreakdownCard
                      label={t('Long session')}
                      totals={validationAiCostBreakdown.long}
                    />
                    <ValidationAiCostBreakdownCard
                      label={t('Reporting')}
                      totals={validationAiCostBreakdown.reporting}
                    />
                    <ValidationAiCostBreakdownCard
                      label={t('Short + long solve')}
                      totals={validationAiCostBreakdown.solveCombined}
                    />
                    <ValidationAiCostBreakdownCard
                      label={t('All AI steps')}
                      totals={validationAiCostBreakdown.overall}
                    />
                  </SimpleGrid>

                  <Stack spacing="2" maxH="240px" overflowY="auto" pr="1">
                    {validationAiCostLedger.entries.map((entry) => (
                      <Box
                        key={entry.id}
                        borderWidth="1px"
                        borderColor="whiteAlpha.200"
                        borderRadius="md"
                        px="3"
                        py="2"
                        bg="whiteAlpha.100"
                      >
                        <Flex justify="space-between" gap="3" wrap="wrap">
                          <Text fontSize="sm" fontWeight={600}>
                            {formatValidationAiAction(entry.action, t)}
                          </Text>
                          <Text color="xwhite.050" fontSize="xs">
                            {formatLedgerTime(entry.time)}
                          </Text>
                        </Flex>
                        <Text color="xwhite.050" fontSize="xs" mt="1">
                          {`${entry.provider} ${entry.model}`}
                        </Text>
                        <Text color="xwhite.050" fontSize="xs" mt="1">
                          {buildValidationAiCostEntrySummary(entry, t)}
                        </Text>
                      </Box>
                    ))}
                  </Stack>
                </Stack>
              </Box>
            )}
          </Stack>
        </Stack>
      </Center>
    </Box>
  )
}

function formatUsd(value) {
  const num = Number(value)

  if (!Number.isFinite(num)) {
    return '–'
  }

  if (num <= 0) {
    return '$0.00'
  }

  if (num < 0.01) {
    return '<$0.01'
  }

  if (num < 1) {
    return `$${num.toFixed(3)}`
  }

  return `$${num.toFixed(2)}`
}

function formatTokenCount(value) {
  const num = Number(value)

  if (!Number.isFinite(num) || num < 0) {
    return '0'
  }

  return new Intl.NumberFormat().format(Math.round(num))
}

function formatLedgerTime(value) {
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format('HH:mm:ss') : ''
}

function formatValidationAiAction(action, t) {
  switch (String(action || '').trim()) {
    case 'short-session solve':
      return t('Short session solve')
    case 'long-session solve':
      return t('Long session solve')
    case 'long-session report review':
      return t('Long session report review')
    default:
      return String(action || '').trim() || t('Unknown action')
  }
}

function buildValidationAiCostEntrySummary(entry, t) {
  const parts = []

  if (Number.isFinite(entry.totalFlips)) {
    parts.push(
      t('{{count}} flips', {
        count: entry.totalFlips,
      })
    )
  }

  if (Number.isFinite(entry.appliedAnswers)) {
    parts.push(
      t('{{count}} applied', {
        count: entry.appliedAnswers,
      })
    )
  }

  parts.push(
    t('tokens {{count}}', {
      count: formatTokenCount(entry.tokenUsage?.totalTokens),
    })
  )
  parts.push(
    t('est {{cost}}', {
      cost: formatUsd(entry.estimatedUsd),
    })
  )
  parts.push(
    t('actual {{cost}}', {
      cost: formatUsd(entry.actualUsd),
    })
  )

  return parts.join(' | ')
}

function BenchmarkStat({label, value}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="whiteAlpha.200"
      borderRadius="md"
      px="3"
      py="2"
      bg="whiteAlpha.100"
    >
      <Text color="xwhite.050" fontSize="xs" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="md" fontWeight={600}>
        {value}
      </Text>
    </Box>
  )
}

function ValidationAiCostBreakdownCard({label, totals}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="whiteAlpha.200"
      borderRadius="md"
      px="3"
      py="2"
      bg="whiteAlpha.100"
    >
      <Text color="xwhite.050" fontSize="xs" textTransform="uppercase">
        {label}
      </Text>
      <Stack spacing="1" mt="1">
        <Text fontSize="sm" fontWeight={600}>
          {`${formatTokenCount(totals?.totalTokens)} tok`}
        </Text>
        <Text color="xwhite.050" fontSize="xs">
          {`est ${formatUsd(totals?.estimatedUsd)} | actual ${formatUsd(
            totals?.actualUsd
          )}`}
        </Text>
        <Text color="xwhite.050" fontSize="xs">
          {`${String(totals?.count || 0)} actions`}
        </Text>
      </Stack>
    </Box>
  )
}
