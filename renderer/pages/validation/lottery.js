import {
  Box,
  Center,
  CloseButton,
  Flex,
  Heading,
  Stack,
  Text,
  chakra,
  Button,
} from '@chakra-ui/react'
import dayjs from 'dayjs'
import NextLink from 'next/link'
import {useRouter} from 'next/router'
import React from 'react'
import {useTranslation} from 'react-i18next'
import {motion, isValidMotionProp} from 'framer-motion'
import {useInterval} from '../../shared/hooks/use-interval'
import {
  canOpenRehearsalValidation,
  getRehearsalCountdownDurationMs,
  getRehearsalValidationBlockedReason,
  normalizeRehearsalDevnetStatus,
  REHEARSAL_DEVNET_STATUS_INITIAL,
  useAutoStartValidation,
} from '../../screens/validation/hooks/use-start-validation'
import {ValidationCountdown} from '../../screens/validation/components/countdown'
import {ErrorAlert} from '../../shared/components/components'
import {useEpochState} from '../../shared/providers/epoch-context'
import {useAutoCloseValidationToast} from '../../screens/validation/hooks/use-validation-toast'
import {EpochPeriod, IdentityStatus} from '../../shared/types'
import {canValidate} from '../../screens/validation/utils'
import {useIdentity} from '../../shared/providers/identity-context'
import {useChainState} from '../../shared/providers/chain-context'
import {Status} from '../../shared/components/sidebar'
import {
  useSettingsState,
  isValidationRehearsalNodeSettings,
} from '../../shared/providers/settings-context'
import {getNodeBridge} from '../../shared/utils/node-bridge'

const shouldForwardProp = (prop) =>
  isValidMotionProp(prop) || ['children'].includes(prop)

const MotionBox = chakra(motion.div, {
  shouldForwardProp,
})

export default function LotteryPage() {
  const {t} = useTranslation()
  const router = useRouter()

  const epoch = useEpochState()
  const [identity] = useIdentity()
  const settings = useSettingsState()
  const {loading, offline, syncing} = useChainState()
  const isRehearsalNodeSession = isValidationRehearsalNodeSettings(settings)
  const [rehearsalDevnetStatus, setRehearsalDevnetStatus] = React.useState(
    REHEARSAL_DEVNET_STATUS_INITIAL
  )

  const isIneligible = !canValidate(identity)
  const showEligibilityError =
    isIneligible &&
    !loading &&
    !offline &&
    !syncing &&
    !identity.fetchingIdentity

  const isValidated = [
    IdentityStatus.Newbie,
    IdentityStatus.Verified,
    IdentityStatus.Human,
  ].includes(identity.state)
  const rehearsalBlockedReason = React.useMemo(
    () =>
      getRehearsalValidationBlockedReason({
        currentPeriod: epoch?.currentPeriod,
        devnetStatus: rehearsalDevnetStatus,
        isRehearsalNodeSession,
      }),
    [epoch?.currentPeriod, isRehearsalNodeSession, rehearsalDevnetStatus]
  )
  const rehearsalValidationOpenable = React.useMemo(
    () =>
      canOpenRehearsalValidation({
        currentPeriod: epoch?.currentPeriod,
        devnetStatus: rehearsalDevnetStatus,
        isRehearsalNodeSession,
      }),
    [epoch?.currentPeriod, isRehearsalNodeSession, rehearsalDevnetStatus]
  )
  const rehearsalCountdownDuration = React.useMemo(
    () => getRehearsalCountdownDurationMs(rehearsalDevnetStatus),
    [rehearsalDevnetStatus]
  )

  useAutoStartValidation()

  useAutoCloseValidationToast()

  React.useEffect(() => {
    if (!isRehearsalNodeSession || getNodeBridge().__idenaFallback) {
      setRehearsalDevnetStatus(REHEARSAL_DEVNET_STATUS_INITIAL)
      return undefined
    }

    const bridge = getNodeBridge()

    bridge.getValidationDevnetStatus()

    return bridge.onEvent((event, data) => {
      if (event === 'validation-devnet-status') {
        setRehearsalDevnetStatus(normalizeRehearsalDevnetStatus(data))
      }
    })
  }, [isRehearsalNodeSession])

  useInterval(
    () => {
      if (isRehearsalNodeSession && !getNodeBridge().__idenaFallback) {
        getNodeBridge().getValidationDevnetStatus()
      }
    },
    isRehearsalNodeSession &&
      [
        EpochPeriod.FlipLottery,
        EpochPeriod.ShortSession,
        EpochPeriod.LongSession,
      ].includes(epoch?.currentPeriod)
      ? 1000
      : null
  )

  let rehearsalStatusTitle = ''
  let rehearsalStatusBody = ''

  if (isRehearsalNodeSession) {
    if (rehearsalBlockedReason === 'before-flip-lottery') {
      rehearsalStatusTitle = t('Rehearsal network is connected')
      rehearsalStatusBody = t(
        'The app is already on the rehearsal node. The countdown below tracks the first rehearsal ceremony start.'
      )
    } else if (rehearsalBlockedReason === 'flip-lottery') {
      rehearsalStatusTitle = t('FlipLottery is live')
      rehearsalStatusBody = t(
        'Hashes can already be assigned during FlipLottery, but rehearsal flips only become solvable after short session begins and public flip keys arrive.'
      )
    } else if (rehearsalBlockedReason === 'hashes-not-assigned') {
      rehearsalStatusTitle = t('Short session started, still assigning flips')
      rehearsalStatusBody = t(
        'The rehearsal node is connected, but validation hashes are still being assigned. IdenaAI will keep waiting here and switch automatically once real session content is ready.'
      )
    } else if (rehearsalBlockedReason === 'keys-not-ready') {
      const assignedCount =
        epoch?.currentPeriod === EpochPeriod.LongSession
          ? rehearsalDevnetStatus.primaryLongHashCount
          : rehearsalDevnetStatus.primaryShortHashCount
      const readyCount =
        epoch?.currentPeriod === EpochPeriod.LongSession
          ? rehearsalDevnetStatus.primaryLongHashReadyCount
          : rehearsalDevnetStatus.primaryShortHashReadyCount

      rehearsalStatusTitle = t('Rehearsal flips are still loading')
      rehearsalStatusBody = t(
        '{{assigned}} rehearsal flips assigned. {{ready}} ready now. Public flip keys and decryption packages are still syncing. IdenaAI will stay in this session window and switch automatically once at least one rehearsal flip is truly ready.',
        {
          assigned: Number.isFinite(assignedCount) ? assignedCount : 0,
          ready: Number.isFinite(readyCount) ? readyCount : 0,
        }
      )
    } else if (rehearsalValidationOpenable) {
      rehearsalStatusTitle = t('Rehearsal validation is ready')
      rehearsalStatusBody = t(
        'Rehearsal flips are ready. IdenaAI will switch into validation automatically.'
      )
    } else if (rehearsalBlockedReason === 'failed-rehearsal') {
      rehearsalStatusTitle = t('This rehearsal run failed')
      rehearsalStatusBody = t(
        'The rehearsal network did not produce ready flips in time, or the primary rehearsal node became unavailable. Restart the rehearsal network for a clean run.'
      )
    }
  }

  let rehearsalStatusBorderColor = 'whiteAlpha.400'
  if (rehearsalBlockedReason === 'failed-rehearsal') {
    rehearsalStatusBorderColor = 'red.400'
  } else if (rehearsalValidationOpenable) {
    rehearsalStatusBorderColor = 'green.400'
  }

  let lotteryContent = null
  if (epoch) {
    if (
      epoch.currentPeriod === EpochPeriod.FlipLottery ||
      (isRehearsalNodeSession &&
        rehearsalBlockedReason === 'before-flip-lottery' &&
        Number.isFinite(rehearsalCountdownDuration))
    ) {
      lotteryContent = (
        <ValidationCountdown
          duration={
            epoch.currentPeriod === EpochPeriod.FlipLottery
              ? dayjs(epoch.nextValidation).diff(dayjs())
              : rehearsalCountdownDuration
          }
        />
      )
    } else if (isRehearsalNodeSession && rehearsalStatusTitle) {
      lotteryContent = (
        <Stack
          spacing="4"
          w="full"
          borderWidth="1px"
          borderColor={rehearsalStatusBorderColor}
          bg="whiteAlpha.100"
          borderRadius="lg"
          px="5"
          py="4"
        >
          <Box minW={0}>
            <Text fontWeight={600} lineHeight="short">
              {rehearsalStatusTitle}
            </Text>
            <Text
              color="xwhite.050"
              fontSize="sm"
              lineHeight="tall"
              whiteSpace="normal"
              overflowWrap="anywhere"
            >
              {rehearsalStatusBody}
            </Text>
          </Box>
          {rehearsalBlockedReason === 'failed-rehearsal' && (
            <Button
              variant="unstyled"
              alignSelf="flex-start"
              fontWeight={600}
              onClick={() => router.push('/settings/node')}
            >
              {t('Open node settings')}
            </Button>
          )}
        </Stack>
      )
    } else {
      lotteryContent = <ValidationCountdown duration={0} />
    }
  }

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
          <CloseButton
            boxSize={4}
            color="white"
            onClick={() => {
              if (identity && epoch) {
                sessionStorage.setItem(
                  'didCloseLotteryScreen',
                  JSON.stringify({
                    address: identity.address,
                    epoch: epoch.epoch,
                  })
                )
              }
            }}
          />
        </NextLink>
      </Flex>

      <Center minH="100vh" overflowX="hidden" overflowY="auto" py={6}>
        <Stack spacing="12" w="full" maxW={['xs', '4xl']}>
          <Box>
            <MotionBox
              initial={{
                y: 0,
              }}
              animate={{
                y: 0,
              }}
              transition={{
                delay: 2.5,
                duration: 0.5,
              }}
            >
              <Stack spacing="6">
                <Stack spacing="2">
                  <Heading fontSize="lg" fontWeight={500}>
                    {t('Idena validation will start soon')}
                  </Heading>
                  <Text color="xwhite.050" fontSize="mdx">
                    {t(
                      'Get ready! Make sure you have a stable internet connection'
                    )}
                  </Text>
                </Stack>

                {lotteryContent}

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
              </Stack>
            </MotionBox>
          </Box>
        </Stack>
      </Center>
    </Box>
  )
}
