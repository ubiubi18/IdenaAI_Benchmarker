/* eslint-disable react/prop-types */
import React from 'react'
import {
  AspectRatio,
  Badge,
  Box,
  Button,
  Center,
  CloseButton,
  Flex,
  Heading,
  Image,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react'
import NextLink from 'next/link'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {reorderList} from '../../shared/utils/arr'
import {getNodeBridge} from '../../shared/utils/node-bridge'
import {Status} from '../../shared/components/sidebar'
import {useIdentity} from '../../shared/providers/identity-context'
import {useSettingsState} from '../../shared/providers/settings-context'
import {
  buildValidationIdentityScope,
  buildValidationSessionNodeScope,
} from '../../screens/validation/utils'
import {usePersistedValidationState} from '../../screens/validation/hooks/use-persisted-state'
import {
  computeRehearsalBenchmarkSummary,
  getRehearsalBenchmarkAuditStatus,
  loadRehearsalBenchmarkReview,
  normalizeRehearsalBenchmarkReviewState,
  persistRehearsalBenchmarkAnnotationDataset,
  persistRehearsalBenchmarkReview,
  countReviewedRehearsalBenchmarkItems,
} from '../../screens/validation/rehearsal-benchmark'

function createEmptyReviewState() {
  return {
    version: 1,
    updatedAt: null,
    annotationsByHash: {},
  }
}

const UNSAFE_REVIEW_HASH_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

function normalizeReviewHashKey(value) {
  const hash = String(value || '')
    .trim()
    .replace(/^_flip_/u, '')

  return UNSAFE_REVIEW_HASH_KEYS.has(hash) ? '' : hash
}

export default function ValidationBenchmarkReviewPage() {
  const {t} = useTranslation()
  const router = useRouter()
  const [identity] = useIdentity()
  const settings = useSettingsState()
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
  const benchmarkSummary = React.useMemo(
    () => computeRehearsalBenchmarkSummary(validationState),
    [validationState]
  )
  const reviewScope = React.useMemo(
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
  const [reviewState, setReviewState] = React.useState(() =>
    loadRehearsalBenchmarkReview(reviewScope)
  )
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const [seedFlipsByHash, setSeedFlipsByHash] = React.useState({})

  React.useEffect(() => {
    setReviewState(loadRehearsalBenchmarkReview(reviewScope))
  }, [reviewScope])

  React.useEffect(() => {
    persistRehearsalBenchmarkReview(reviewScope, reviewState)
    persistRehearsalBenchmarkAnnotationDataset({
      scope: reviewScope,
      items: benchmarkSummary.items,
      reviewState,
    })
  }, [benchmarkSummary.items, reviewScope, reviewState])

  React.useEffect(() => {
    if (benchmarkSummary.total === 0) {
      setCurrentIndex(0)
      return
    }

    setCurrentIndex((value) =>
      Math.max(0, Math.min(value, benchmarkSummary.total - 1))
    )
  }, [benchmarkSummary.total])

  const reviewedCount = React.useMemo(
    () =>
      countReviewedRehearsalBenchmarkItems(reviewState, benchmarkSummary.items),
    [benchmarkSummary.items, reviewState]
  )
  const auditStatus = React.useMemo(
    () => getRehearsalBenchmarkAuditStatus(reviewState, benchmarkSummary.items),
    [benchmarkSummary.items, reviewState]
  )

  const currentItem = benchmarkSummary.items[currentIndex]
  const currentHash = normalizeReviewHashKey(currentItem?.hash)
  const currentSourceHash = normalizeReviewHashKey(currentItem?.sourceHash)
  const restoredSeedFlip =
    seedFlipsByHash[currentHash] ||
    (currentSourceHash ? seedFlipsByHash[currentSourceHash] : null)
  const currentReviewItem = React.useMemo(
    () => mergeReviewItemSeedImages(currentItem, restoredSeedFlip),
    [currentItem, restoredSeedFlip]
  )
  const currentAnnotation = reviewState.annotationsByHash?.[currentHash] || {}

  React.useEffect(() => {
    const lookupHashes = [currentHash, currentSourceHash].filter(Boolean)

    if (
      lookupHashes.length === 0 ||
      hasReviewItemImages(currentItem) ||
      restoredSeedFlip
    ) {
      return undefined
    }

    let isCancelled = false

    async function restoreSeedImages() {
      const nodeBridge = getNodeBridge()

      if (typeof nodeBridge.getValidationDevnetSeedFlip !== 'function') {
        return
      }

      for (const hash of lookupHashes) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const payload = await nodeBridge.getValidationDevnetSeedFlip(hash)
          const normalizedPayload = normalizeReviewSeedFlipPayload(payload)

          if (normalizedPayload) {
            if (!isCancelled) {
              setSeedFlipsByHash((prev) => {
                const next = {...prev}

                lookupHashes.forEach((lookupHash) => {
                  next[lookupHash] = normalizedPayload
                })
                next[normalizedPayload.hash] = normalizedPayload

                if (normalizedPayload.sourceHash) {
                  next[normalizedPayload.sourceHash] = normalizedPayload
                }

                return next
              })
            }

            return
          }
        } catch {
          // Try the next hash before marking this review item as unavailable.
        }
      }

      if (!isCancelled) {
        setSeedFlipsByHash((prev) => ({
          ...prev,
          [lookupHashes[0]]: {missing: true},
        }))
      }
    }

    restoreSeedImages()

    return () => {
      isCancelled = true
    }
  }, [currentHash, currentItem, currentSourceHash, restoredSeedFlip])

  const updateCurrentAnnotation = React.useCallback(
    (patch) => {
      const annotationHash = normalizeReviewHashKey(currentItem?.hash)

      if (!annotationHash) {
        return
      }

      setReviewState((prev) => {
        const next = normalizeRehearsalBenchmarkReviewState(
          prev || createEmptyReviewState()
        )
        const previousAnnotation =
          next.annotationsByHash?.[annotationHash] || {}

        return {
          ...next,
          auditStatus: next.auditStatus === 'skipped' ? '' : next.auditStatus,
          annotationsByHash: {
            ...(next.annotationsByHash || {}),
            [annotationHash]: {
              ...previousAnnotation,
              ...patch,
              updatedAt: new Date().toISOString(),
            },
          },
        }
      })
    },
    [currentItem?.hash]
  )

  React.useEffect(() => {
    setReviewState((prev) => {
      const next = normalizeRehearsalBenchmarkReviewState(
        prev || createEmptyReviewState()
      )

      let nextAuditStatus = next.auditStatus

      if (
        benchmarkSummary.total > 0 &&
        reviewedCount >= benchmarkSummary.total
      ) {
        nextAuditStatus = 'completed'
      } else if (reviewedCount > 0 && nextAuditStatus === 'skipped') {
        nextAuditStatus = ''
      } else if (reviewedCount === 0 && nextAuditStatus === 'completed') {
        nextAuditStatus = ''
      }

      if (nextAuditStatus === next.auditStatus) {
        return prev
      }

      return {
        ...next,
        auditStatus: nextAuditStatus,
      }
    })
  }, [benchmarkSummary.total, reviewedCount])

  const skipAuditForNow = React.useCallback(() => {
    const nextState = normalizeRehearsalBenchmarkReviewState({
      ...reviewState,
      auditStatus: 'skipped',
    })

    setReviewState(nextState)
    persistRehearsalBenchmarkReview(reviewScope, nextState)
    router.push('/validation/after')
  }, [reviewScope, reviewState, router])

  if (!benchmarkSummary.available) {
    return (
      <BenchmarkPageShell>
        <Stack spacing="6" w={['xs', '640px']}>
          <Heading fontSize="lg" fontWeight={500}>
            {t('No rehearsal benchmark is available')}
          </Heading>
          <Text color="xwhite.050" fontSize="md">
            {t(
              'This page only works for rehearsal runs that used bundled FLIP-Challenge seed labels.'
            )}
          </Text>
          <Button
            alignSelf="flex-start"
            onClick={() => router.push('/validation/after')}
          >
            {t('Back to results')}
          </Button>
        </Stack>
      </BenchmarkPageShell>
    )
  }

  return (
    <BenchmarkPageShell>
      <Stack spacing="6" w={['full', '1100px']} px={[0, 4]}>
        <Flex
          justify="space-between"
          align="flex-start"
          gap="4"
          flexWrap="wrap"
        >
          <Box>
            <Heading fontSize="lg" fontWeight={500}>
              {t('Rehearsal benchmark review')}
            </Heading>
            <Text color="xwhite.050" fontSize="sm" maxW="720px">
              {t(benchmarkSummary.note)}
            </Text>
            <Text color="xwhite.050" fontSize="sm" maxW="720px" mt="2">
              {auditStatus === 'completed'
                ? t(
                    'Optional audit completed for this rehearsal run. You can still edit the annotations below.'
                  )
                : t(
                    'Optional audit for this rehearsal run. Annotate the results now, or skip and return later.'
                  )}
            </Text>
          </Box>
          <Stack direction={['column', 'row']} spacing="3">
            {auditStatus !== 'completed' ? (
              <Button variant="ghost" onClick={skipAuditForNow}>
                {t('Skip audit for now')}
              </Button>
            ) : null}
            <Button onClick={() => router.push('/validation/after')}>
              {t('Back to results')}
            </Button>
          </Stack>
        </Flex>

        <SimpleGrid columns={[2, 4]} spacing="3">
          <ReviewStat
            label={t('Correct')}
            value={`${benchmarkSummary.correct}/${benchmarkSummary.total}`}
          />
          <ReviewStat
            label={t('Accuracy')}
            value={`${((benchmarkSummary.accuracy || 0) * 100).toFixed(1)}%`}
          />
          <ReviewStat
            label={t('Reports')}
            value={String(benchmarkSummary.reported)}
          />
          <ReviewStat
            label={t('Reviewed')}
            value={`${reviewedCount}/${benchmarkSummary.total}`}
          />
        </SimpleGrid>

        <Flex
          justify="space-between"
          align="center"
          gap="3"
          flexWrap="wrap"
          borderWidth="1px"
          borderColor="whiteAlpha.300"
          borderRadius="lg"
          px="4"
          py="3"
          bg="whiteAlpha.100"
        >
          <Stack spacing="1">
            <Text fontSize="sm" color="xwhite.050">
              {t('Flip {{current}} of {{total}}', {
                current: currentIndex + 1,
                total: benchmarkSummary.total,
              })}
            </Text>
            <Stack direction="row" spacing="2" flexWrap="wrap">
              <Badge colorScheme="blue">{currentItem.sessionType}</Badge>
              <Badge colorScheme={currentItem.isCorrect ? 'green' : 'red'}>
                {currentItem.isCorrect ? t('Match') : t('Mismatch')}
              </Badge>
              {currentItem.reported ? (
                <Badge colorScheme="orange">{t('Reported')}</Badge>
              ) : null}
              {currentItem.best ? (
                <Badge colorScheme="purple">{t('Best')}</Badge>
              ) : null}
            </Stack>
          </Stack>

          <Stack direction="row" spacing="3">
            <Button
              variant="outline"
              onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))}
              isDisabled={currentIndex === 0}
            >
              {t('Previous')}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setCurrentIndex((value) =>
                  Math.min(benchmarkSummary.total - 1, value + 1)
                )
              }
              isDisabled={currentIndex >= benchmarkSummary.total - 1}
            >
              {t('Next')}
            </Button>
          </Stack>
        </Flex>

        <SimpleGrid columns={[1, null, 2]} spacing="6">
          <StoryPreviewCard
            title={t('Left story')}
            images={currentReviewItem?.images}
            order={currentReviewItem?.orders?.[0]}
            isExpected={currentItem?.expectedAnswer === 'left'}
            isSelected={currentItem?.selectedAnswer === 'left'}
          />
          <StoryPreviewCard
            title={t('Right story')}
            images={currentReviewItem?.images}
            order={currentReviewItem?.orders?.[1]}
            isExpected={currentItem?.expectedAnswer === 'right'}
            isSelected={currentItem?.selectedAnswer === 'right'}
          />
        </SimpleGrid>

        <SimpleGrid columns={[1, null, 2]} spacing="6">
          <Box
            borderWidth="1px"
            borderColor="whiteAlpha.300"
            borderRadius="lg"
            px="4"
            py="4"
            bg="whiteAlpha.100"
          >
            <Stack spacing="3">
              <Heading fontSize="md" fontWeight={500}>
                {t('Run outcome')}
              </Heading>
              <OutcomeRow
                label={t('Expected answer')}
                value={formatAnswerLabel(currentItem?.expectedAnswer, t)}
              />
              <OutcomeRow
                label={t('Selected answer')}
                value={formatAnswerLabel(currentItem?.selectedAnswer, t)}
              />
              <OutcomeRow
                label={t('Benchmark strength')}
                value={currentItem?.expectedStrength || t('Unknown')}
              />
              <OutcomeRow
                label={t('Report selected')}
                value={currentItem?.reported ? t('Yes') : t('No')}
              />
              <OutcomeRow
                label={t('Flip hash')}
                value={String(currentItem?.hash || '–')}
              />
            </Stack>
          </Box>

          <Box
            borderWidth="1px"
            borderColor="whiteAlpha.300"
            borderRadius="lg"
            px="4"
            py="4"
            bg="whiteAlpha.100"
          >
            <Stack spacing="4">
              <Heading fontSize="md" fontWeight={500}>
                {t('Manual review')}
              </Heading>

              <Stack spacing="2">
                <Text color="xwhite.050" fontSize="sm">
                  {t('Benchmark check')}
                </Text>
                <Flex gap="2" flexWrap="wrap">
                  <ReviewToggleButton
                    active={currentAnnotation.status === 'match'}
                    onClick={() => updateCurrentAnnotation({status: 'match'})}
                  >
                    {t('Benchmark looks right')}
                  </ReviewToggleButton>
                  <ReviewToggleButton
                    active={currentAnnotation.status === 'mismatch'}
                    onClick={() =>
                      updateCurrentAnnotation({status: 'mismatch'})
                    }
                  >
                    {t('Benchmark looks wrong')}
                  </ReviewToggleButton>
                  <ReviewToggleButton
                    active={currentAnnotation.status === 'unclear'}
                    onClick={() => updateCurrentAnnotation({status: 'unclear'})}
                  >
                    {t('Unclear')}
                  </ReviewToggleButton>
                </Flex>
              </Stack>

              <Stack spacing="2">
                <Text color="xwhite.050" fontSize="sm">
                  {t('Auto-report check')}
                </Text>
                <Flex gap="2" flexWrap="wrap">
                  <ReviewToggleButton
                    active={currentAnnotation.reportStatus === 'ok'}
                    onClick={() =>
                      updateCurrentAnnotation({reportStatus: 'ok'})
                    }
                  >
                    {t('No issue')}
                  </ReviewToggleButton>
                  <ReviewToggleButton
                    active={currentAnnotation.reportStatus === 'false_positive'}
                    onClick={() =>
                      updateCurrentAnnotation({reportStatus: 'false_positive'})
                    }
                  >
                    {t('False report')}
                  </ReviewToggleButton>
                  <ReviewToggleButton
                    active={currentAnnotation.reportStatus === 'missed_report'}
                    onClick={() =>
                      updateCurrentAnnotation({reportStatus: 'missed_report'})
                    }
                  >
                    {t('Missed report')}
                  </ReviewToggleButton>
                  <ReviewToggleButton
                    active={currentAnnotation.reportStatus === 'unclear'}
                    onClick={() =>
                      updateCurrentAnnotation({reportStatus: 'unclear'})
                    }
                  >
                    {t('Unclear')}
                  </ReviewToggleButton>
                </Flex>
              </Stack>

              <Stack spacing="2">
                <Text color="xwhite.050" fontSize="sm">
                  {t('Notes')}
                </Text>
                <Textarea
                  value={currentAnnotation.note || ''}
                  onChange={(event) =>
                    updateCurrentAnnotation({note: event.target.value})
                  }
                  placeholder={t(
                    'Optional note about ambiguity, wrong benchmark, or reporting.'
                  )}
                  minH="140px"
                />
              </Stack>
            </Stack>
          </Box>
        </SimpleGrid>
      </Stack>
    </BenchmarkPageShell>
  )
}

function BenchmarkPageShell({children}) {
  return (
    <Box
      bg="graphite.500"
      color="white"
      fontSize="md"
      p={['8', 0]}
      pt={['2', 0]}
      position="relative"
      w="full"
      minH="100vh"
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
        <NextLink href="/validation/after" passHref>
          <CloseButton boxSize={4} color="white" />
        </NextLink>
      </Flex>

      <Center color="white" minH="100vh" alignItems="flex-start" pt={[4, 16]}>
        {children}
      </Center>
    </Box>
  )
}

function ReviewStat({label, value}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="whiteAlpha.300"
      borderRadius="lg"
      px="4"
      py="3"
      bg="whiteAlpha.100"
    >
      <Text color="xwhite.050" fontSize="xs" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="lg" fontWeight={600}>
        {value}
      </Text>
    </Box>
  )
}

function hasReviewItemImages(item) {
  return Array.isArray(item?.images)
    ? item.images.filter((src) => typeof src === 'string' && src.trim())
        .length >= 4
    : false
}

function normalizeReviewSeedFlipPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const images = Array.isArray(payload.images)
    ? payload.images
        .map((src) => String(src || '').trim())
        .filter(Boolean)
        .slice(0, 4)
    : []
  const orders = Array.isArray(payload.orders)
    ? payload.orders
        .slice(0, 2)
        .map((order) =>
          Array.isArray(order)
            ? order
                .map((index) => Number.parseInt(index, 10))
                .filter((index) => Number.isInteger(index))
                .slice(0, 4)
            : []
        )
        .filter((order) => order.length === 4)
    : []

  const hash = normalizeReviewHashKey(payload.hash)

  if (!hash || images.length !== 4 || orders.length !== 2) {
    return null
  }

  return {
    hash,
    sourceHash: normalizeReviewHashKey(payload.sourceHash),
    images,
    orders,
  }
}

function mergeReviewItemSeedImages(item, restoredSeedFlip) {
  if (
    !item ||
    hasReviewItemImages(item) ||
    !hasReviewItemImages(restoredSeedFlip)
  ) {
    return item
  }

  return {
    ...item,
    images: restoredSeedFlip.images,
    orders:
      Array.isArray(item.orders) && item.orders.length >= 2
        ? item.orders
        : restoredSeedFlip.orders,
  }
}

function StoryPreviewCard({
  title,
  images = [],
  order = [],
  isExpected = false,
  isSelected = false,
}) {
  let normalizedOrder = []

  if (Array.isArray(order) && order.length > 0) {
    normalizedOrder = order
  } else if (Array.isArray(images)) {
    normalizedOrder = images.map((_, index) => index)
  }

  const orderedImages = Array.isArray(images)
    ? reorderList(images, normalizedOrder)
    : []
  const imageSlots =
    orderedImages.length > 0
      ? orderedImages.slice(0, 4)
      : [null, null, null, null]
  let borderColor = 'whiteAlpha.300'

  if (isExpected) {
    borderColor = 'green.300'
  } else if (isSelected) {
    borderColor = 'blue.300'
  }

  return (
    <Box
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="lg"
      px="4"
      py="4"
      bg="whiteAlpha.100"
    >
      <Stack spacing="3">
        <Flex justify="space-between" align="center" gap="3">
          <Heading fontSize="md" fontWeight={500}>
            {title}
          </Heading>
          <Stack direction="row" spacing="2">
            {isExpected ? <Badge colorScheme="green">Expected</Badge> : null}
            {isSelected ? <Badge colorScheme="blue">Selected</Badge> : null}
          </Stack>
        </Flex>

        <SimpleGrid columns={2} spacing="3">
          {imageSlots.map((src, index) => (
            <AspectRatio key={`${title}-${index}`} ratio={4 / 3}>
              <Box
                borderRadius="md"
                overflow="hidden"
                bg="whiteAlpha.200"
                borderWidth="1px"
                borderColor="whiteAlpha.200"
              >
                {src ? (
                  <Image
                    src={src}
                    alt={`${title}-${index + 1}`}
                    objectFit="cover"
                    w="full"
                    h="full"
                    ignoreFallback
                  />
                ) : (
                  <Center h="full">
                    <Text color="xwhite.050" fontSize="sm">
                      No image
                    </Text>
                  </Center>
                )}
              </Box>
            </AspectRatio>
          ))}
        </SimpleGrid>
      </Stack>
    </Box>
  )
}

function OutcomeRow({label, value}) {
  return (
    <Flex justify="space-between" gap="4" align="flex-start">
      <Text color="xwhite.050" fontSize="sm">
        {label}
      </Text>
      <Text
        fontSize="sm"
        fontWeight={500}
        textAlign="right"
        wordBreak="break-word"
      >
        {value}
      </Text>
    </Flex>
  )
}

function ReviewToggleButton({active = false, children, ...props}) {
  return (
    <Button
      variant={active ? 'solid' : 'outline'}
      colorScheme={active ? 'blue' : 'gray'}
      {...props}
    >
      {children}
    </Button>
  )
}

function formatAnswerLabel(value, t) {
  switch (
    String(value || '')
      .trim()
      .toLowerCase()
  ) {
    case 'left':
      return t('Left')
    case 'right':
      return t('Right')
    case 'skip':
      return t('Skip')
    default:
      return t('Unanswered')
  }
}
