/* eslint-disable react/prop-types */
import React, {useEffect} from 'react'
import Head from 'next/head'
import {useRouter} from 'next/router'
import {ChakraProvider, extendTheme} from '@chakra-ui/react'
import GoogleFonts from 'next-google-fonts'
// eslint-disable-next-line import/no-extraneous-dependencies
import 'tui-image-editor/dist/tui-image-editor.css'
import '../i18n'
import {QueryClientProvider} from 'react-query'
import {theme} from '../shared/theme'
import {NodeProvider} from '../shared/providers/node-context'
import {SettingsProvider} from '../shared/providers/settings-context'
import {AutoUpdateProvider} from '../shared/providers/update-context'
import {ChainProvider} from '../shared/providers/chain-context'
import {TimingProvider} from '../shared/providers/timing-context'
import {EpochProvider} from '../shared/providers/epoch-context'
import {IdentityProvider} from '../shared/providers/identity-context'
import {VotingNotificationProvider} from '../shared/providers/voting-notification-context'
import {OnboardingProvider} from '../shared/providers/onboarding-context'
import {queryClient} from '../shared/utils/utils'
import {
  APP_VERSION_FALLBACK,
  getSharedGlobal,
} from '../shared/utils/shared-global'
import {createSublevelDb} from '../shared/utils/db'

// err is a workaround for https://github.com/zeit/next.js/issues/8592
export default function App({Component, err, ...pageProps}) {
  const router = useRouter()
  const isAdsRoute = router.pathname.startsWith('/adn')

  useEffect(() => {
    if (isAdsRoute) {
      router.replace('/home')
    }
  }, [isAdsRoute, router])

  if (isAdsRoute) {
    return null
  }

  return (
    <>
      <GoogleFonts href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
      <Head>
        <link href="/static/scrollbars.css" rel="stylesheet" />
      </Head>

      <ChakraProvider theme={extendTheme(theme)}>
        <AppProviders>
          <Component err={err} {...pageProps} />
        </AppProviders>
      </ChakraProvider>
    </>
  )
}

function AppProviders(props) {
  if (typeof window !== 'undefined') {
    const createFallbackBridge = (value) =>
      Object.defineProperty(value, '__idenaFallback', {
        value: true,
        enumerable: false,
      })
    const legacyGlobal =
      typeof global !== 'undefined' && global ? global : window
    const readonlyWindowCompatKeys = new Set(['Buffer'])
    const shouldAssignCompatValue = (target, key) => {
      if (!target) {
        return false
      }

      if (target === window && readonlyWindowCompatKeys.has(key)) {
        return false
      }

      const descriptor =
        Object.getOwnPropertyDescriptor(target, key) ||
        Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(target) || {},
          key
        )

      return (
        !descriptor ||
        descriptor.writable ||
        typeof descriptor.set === 'function'
      )
    }
    const dnaFallback = createFallbackBridge({
      getPendingLink: async () => undefined,
      onLink: () => {},
      offLink: () => {},
    })
    const eventBridgeFallback = createFallbackBridge({
      onEvent: () => {},
      offEvent: () => {},
      sendCommand: () => {},
    })
    const ipcRendererFallback = createFallbackBridge({
      on: () => {},
      send: () => {},
      removeListener: () => {},
      invoke: async () => undefined,
    })

    const compat = {
      appVersion: getSharedGlobal('appVersion', APP_VERSION_FALLBACK),
      env: getSharedGlobal('env', {}),
      isDev: getSharedGlobal('isDev', false),
      isMac: getSharedGlobal('isMac', false),
      isTest: getSharedGlobal('isTest', false),
      ipcRenderer: getSharedGlobal('ipcRenderer', ipcRendererFallback),
      logger: getSharedGlobal('logger', console),
      openExternal: getSharedGlobal('openExternal', () =>
        Promise.resolve(false)
      ),
      getZoomLevel: getSharedGlobal('getZoomLevel', () => 0),
      setZoomLevel: getSharedGlobal('setZoomLevel', () => {}),
      toggleFullScreen: getSharedGlobal('toggleFullScreen', () =>
        Promise.resolve()
      ),
      links: getSharedGlobal('links', {}),
      dna: getSharedGlobal('dna', dnaFallback),
      updates: getSharedGlobal('updates', eventBridgeFallback),
      node: getSharedGlobal('node', eventBridgeFallback),
      search: getSharedGlobal('search', {}),
      aiSolver: getSharedGlobal('aiSolver', {}),
      aiTestUnit: getSharedGlobal('aiTestUnit', {}),
      localAi: getSharedGlobal('localAi', {}),
      flipStore: getSharedGlobal('flipStore', {}),
      invitesDb: getSharedGlobal('invitesDb', {}),
      contactsDb: getSharedGlobal('contactsDb', {}),
      storage: getSharedGlobal('storage', {}),
      db: getSharedGlobal('db', {}),
      clipboard: getSharedGlobal('clipboard', {}),
      nativeImage: getSharedGlobal('nativeImage', {}),
      social: getSharedGlobal('social', {}),
      sub: createSublevelDb,
      levelup: getSharedGlobal('levelup'),
      leveldown: getSharedGlobal('leveldown'),
      dbPath: getSharedGlobal('dbPath'),
      prepareDb: getSharedGlobal('prepareDb'),
      locale: getSharedGlobal('locale', 'en'),
    }

    Object.entries(compat).forEach(([key, value]) => {
      if (!shouldAssignCompatValue(legacyGlobal, key)) {
        return
      }

      try {
        legacyGlobal[key] = value
      } catch {
        // Ignore read-only globals while preserving legacy compat keys.
      }
    })

    if (legacyGlobal !== window) {
      Object.entries(compat).forEach(([key, value]) => {
        if (!shouldAssignCompatValue(window, key)) {
          return
        }

        try {
          window[key] = value
        } catch {
          // Ignore read-only browser globals as well.
        }
      })
    }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <AutoUpdateProvider>
          <NodeProvider>
            <ChainProvider>
              <TimingProvider>
                <EpochProvider>
                  <IdentityProvider>
                    <OnboardingProvider>
                      <VotingNotificationProvider {...props} />
                    </OnboardingProvider>
                  </IdentityProvider>
                </EpochProvider>
              </TimingProvider>
            </ChainProvider>
          </NodeProvider>
        </AutoUpdateProvider>
      </SettingsProvider>
    </QueryClientProvider>
  )
}
