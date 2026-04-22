import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import relativeTime from 'dayjs/plugin/relativeTime'
import {QueryClient} from 'react-query'
import i18n from '../../i18n'
import {EpochPeriod} from '../types'
import bundledLegacyKeywords from '../../../idena-go/keywords/keywords.json'

dayjs.extend(duration)
dayjs.extend(relativeTime)

export const HASH_IN_MEMPOOL =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

export const queryClient = new QueryClient()

const LEGACY_KEYWORDS_URL =
  'https://raw.githubusercontent.com/idena-network/idena-go/v1.1.2/keywords/keywords.json'

let legacyKeywordsPromise = null
const BUNDLED_LEGACY_KEYWORDS = Array.isArray(bundledLegacyKeywords)
  ? bundledLegacyKeywords
  : []

function getRpcBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.rpc &&
    typeof window.idena.rpc.call === 'function'
  ) {
    return window.idena.rpc
  }

  return null
}

export function createRpcCaller({url, key} = {}) {
  return async function (method, ...params) {
    const rpcBridge = getRpcBridge()
    const response = rpcBridge
      ? await rpcBridge.call({
          method,
          params,
          id: 1,
        })
      : await (
          await fetch(url, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              method,
              params,
              id: 1,
              key,
            }),
          })
        ).json()

    const {result, error} = response
    if (error) throw new Error(error.message)
    return result
  }
}

export function callRpc(method, ...params) {
  return createRpcCaller()(method, ...params)
}

export function toPercent(value, locale) {
  return value?.toLocaleString(locale ?? i18n.language, {
    style: 'percent',
    maximumSignificantDigits: 4,
  })
}

export const toLocaleDna = (locale, options) => {
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 18,
    ...options,
  })
  return (value) => `${formatter.format(value)} iDNA`
}

export const eitherState = (current, ...states) => states.some(current.matches)

export const merge =
  (predicate) =>
  (...lists) =>
    lists.reduce(
      (agg, curr) =>
        agg.length
          ? agg.map((item) => ({
              ...item,
              ...curr.find(predicate(item)),
            }))
          : curr,
      []
    )

export const byId =
  ({id: givenId}) =>
  ({id: currentId}) =>
    currentId === givenId

export const mergeById = (...items) => merge(byId)(...items)

export function clampValue(min, max, value) {
  return Math.min(Math.max(value, min), max)
}

export function roundToPrecision(precision, value) {
  return (
    Math.ceil((Number(value) + Number.EPSILON) * 10 ** precision) /
    10 ** precision
  )
}

// the NTP algorithm
// t0 is the client's timestamp of the request packet transmission,
// t1 is the server's timestamp of the request packet reception,
// t2 is the server's timestamp of the response packet transmission and
// t3 is the client's timestamp of the response packet reception.
export function ntp(t0, t1, t2, t3) {
  return {
    roundTripDelay: t3 - t0 - (t2 - t1),
    offset: (t1 - t0 + (t2 - t3)) / 2,
  }
}

export function buildNextValidationCalendarLink(nextValidation) {
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&dates=${dayjs(
    nextValidation
  ).format('YYYYMMDDTHHmmssZ')}%2F${dayjs(nextValidation)
    .add(30, 'minute')
    .format(
      'YYYYMMDDTHHmmssZ'
    )}&details=Plan%20your%20time%20in%20advance%20to%20take%20part%20in%20the%20validation%20ceremony%21%20Before%20the%20ceremony%2C%20read%20our%20explainer%20of%20how%20to%20get%20validated%3A%20https%3A%2F%2Fmedium.com%2Fidena%2Fhow-to-pass-a-validation-session-in-idena-1724a0203e81&text=Idena%20Validation%20Ceremony`
}

export function formatValidationDate(nextValidation, locale) {
  return new Date(nextValidation).toLocaleString(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export async function loadKeyword(index) {
  try {
    const resp = await queryClient.fetchQuery({
      queryKey: ['bcn_keyWord', index],
      queryFn: ({queryKey: [, wordIndex]}) => callRpc('bcn_keyWord', wordIndex),
      staleTime: Infinity,
    })
    if (resp && (resp.Name || resp.Desc)) {
      return {name: resp.Name || '', desc: resp.Desc || ''}
    }
  } catch (error) {
    if (typeof global !== 'undefined' && global.logger && global.logger.error) {
      global.logger.error('Unable to receive keyword from local RPC', index)
    }
  }

  try {
    const fallbackKeyword = await queryClient.fetchQuery({
      queryKey: ['legacy_keyword', index],
      queryFn: async ({queryKey: [, wordIndex]}) =>
        getLegacyKeyword(wordIndex) || buildKeywordPlaceholder(wordIndex),
      staleTime: Infinity,
    })
    return fallbackKeyword
  } catch (error) {
    if (typeof global !== 'undefined' && global.logger && global.logger.error) {
      global.logger.error('Unable to receive fallback keyword', index)
    }
    return buildKeywordPlaceholder(index)
  }
}

function buildKeywordPlaceholder(index) {
  return {
    name: `keyword-${index}`,
    desc: 'offline fallback keyword',
  }
}

async function getLegacyKeywords() {
  if (BUNDLED_LEGACY_KEYWORDS.length > 0) {
    return BUNDLED_LEGACY_KEYWORDS
  }

  if (!legacyKeywordsPromise) {
    legacyKeywordsPromise = fetch(LEGACY_KEYWORDS_URL, {
      method: 'GET',
      cache: 'no-store',
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Legacy keywords request failed with status ${response.status}`
          )
        }
        return response.json()
      })
      .then((payload) => (Array.isArray(payload) ? payload : []))
      .catch((error) => {
        if (
          typeof global !== 'undefined' &&
          global.logger &&
          global.logger.error
        ) {
          global.logger.error(
            'Unable to load legacy keywords dataset',
            error && error.message ? error.message : error
          )
        }
        return []
      })
  }

  return legacyKeywordsPromise
}

async function getLegacyKeyword(index) {
  const keywords = await getLegacyKeywords()
  if (!Array.isArray(keywords) || index < 0 || index >= keywords.length) {
    return null
  }
  const item = keywords[index] || {}
  return {
    name: item.name || `keyword-${index}`,
    desc: item.desc || '',
  }
}

export const dummyAddress = `0x${'2'.repeat(64)}`

export function showWindowNotification(title, notificationBody, onclick) {
  const notification = new window.Notification(title, {
    body: notificationBody,
  })
  notification.onclick = onclick
  return true
}

export function shouldShowUpcomingValidationNotification(
  epoch,
  upcomingValidationEpoch
) {
  if (!epoch) {
    return false
  }
  const isFlipLottery = epoch.currentPeriod === EpochPeriod.FlipLottery
  const currentEpoch = epoch.epoch
  const notificationShown = currentEpoch + 1 === upcomingValidationEpoch
  return isFlipLottery && !notificationShown
}

export function calculateInvitationRewardRatio(
  {startBlock, nextValidation},
  {highestBlock}
) {
  const endBlock =
    highestBlock + dayjs(nextValidation).diff(dayjs(), 'minute') * 3

  const t = (highestBlock - startBlock) / (endBlock - startBlock)

  return Math.max(1 - t ** 4 * 0.5, 0)
}

export function skipSSR(expr) {
  // eslint-disable-next-line no-nested-ternary
  return typeof window === 'undefined'
    ? null
    : typeof expr === 'function'
    ? expr()
    : expr
}

export const isAddress = (address) =>
  address && address.length === 42 && address.substr(0, 2) === '0x'

export const humanizeDuration = (d, unit = 's') =>
  dayjs.duration(d, unit).humanize()

export function pick(obj, keys) {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => keys.includes(k))
  )
}

export function omit(obj, keys) {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keys.includes(k))
  )
}

export const prependHex = (hex) => (hex?.startsWith('0x') ? hex : `0x${hex}`)

export function areSameCaseInsensitive(a, b) {
  return a?.toUpperCase() === b?.toUpperCase()
}

export function hexToObject(hex) {
  try {
    return JSON.parse(
      new TextDecoder().decode(Buffer.from(hex.substring(2), 'hex'))
    )
  } catch {
    return {}
  }
}
