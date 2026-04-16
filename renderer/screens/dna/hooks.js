import {useRouter} from 'next/router'
import * as React from 'react'
import {areSameCaseInsensitive} from '../oracles/utils'
import {dnaLinkMethod, extractQueryParams, isValidDnaUrl} from './utils'
import {getDnaBridge} from '../../shared/utils/dna-bridge'

export const DnaLinkMethod = {
  SignIn: 'signin',
  Send: 'send',
  RawTx: 'raw',
  Vote: 'vote',
  Invite: 'invite',
}

function getDnaBridge() {
  const bridge = getSharedGlobal('dna', {})

  return {
    getPendingLink:
      typeof bridge?.getPendingLink === 'function'
        ? bridge.getPendingLink
        : async () => undefined,
    onLink: typeof bridge?.onLink === 'function' ? bridge.onLink : () => {},
    offLink: typeof bridge?.offLink === 'function' ? bridge.offLink : () => {},
  }
}

export function useDnaLink({onInvalidLink}) {
  const [url, setUrl] = React.useState()
  const logger = getSharedGlobal('logger', console)

  React.useEffect(() => {
    if (!sessionStorage.getItem('didCheckDnaLink')) {
      getDnaBridge().checkLink().then(setUrl)
      sessionStorage.setItem('didCheckDnaLink', 1)
    }
  }, [])

  React.useEffect(() => getDnaBridge().onLink(setUrl), [])

  const [method, setMethod] = React.useState()

  const [params, setParams] = React.useState({})

  React.useEffect(() => {
    if (isValidDnaUrl(url)) {
      setMethod(dnaLinkMethod(url))

      const {
        callback_url: callbackUrl,
        callback_format: callbackFormat,
        ...dnaQueryParams
      } = extractQueryParams(url)

      setParams({
        ...dnaQueryParams,
        callbackUrl,
        callbackFormat,
      })
    }
  }, [url])

  React.useEffect(() => {
    if (url && !isValidDnaUrl(url)) {
      logger.error('Receieved invalid dna url', url)
      if (onInvalidLink) onInvalidLink(url)
    }
  }, [logger, onInvalidLink, url])

  return {url, method, params}
}

export function useDnaLinkMethod(method, {onReceive, onInvalidLink}) {
  const dnaLink = useDnaLink({onInvalidLink})
  const {url, method: currentMethod} = dnaLink

  React.useEffect(() => {
    if (currentMethod === method) {
      if (onReceive) onReceive(url)
    }
  }, [currentMethod, method, onReceive, url])

  return dnaLink
}

export function useDnaLinkRedirect(method, url, {onInvalidLink}) {
  const router = useRouter()

  const {params} = useDnaLinkMethod(method, {
    onReceive: () => {
      const targetUrl = typeof url === 'function' ? url(params) : url
      if (!areSameCaseInsensitive(router.asPath, targetUrl)) {
        router.push(targetUrl)
      }
    },
    onInvalidLink,
  })
}
