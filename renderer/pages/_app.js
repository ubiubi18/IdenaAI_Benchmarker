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
    if (!global.env) {
      global.env = {}
    }

    if (!global.logger) {
      const noop = () => {}
      global.logger = {
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
      }
    }

    if (!global.ipcRenderer) {
      const noop = () => {}
      global.ipcRenderer = {
        on: noop,
        send: noop,
        removeListener: noop,
        invoke: async () => ({}),
      }
    }

    if (!global.sub) {
      global.sub = (db) => db
    }

    if (!global.aiSolver) {
      const empty = async () => ({})
      global.aiSolver = {
        setProviderKey: empty,
        clearProviderKey: empty,
        hasProviderKey: async () => ({
          ok: true,
          provider: 'openai',
          hasKey: false,
        }),
        testProvider: empty,
        listModels: async () => ({
          ok: true,
          provider: 'openai',
          total: 0,
          models: [],
        }),
        solveFlipBatch: empty,
      }
    }

    if (!global.aiTestUnit) {
      const empty = async () => ({ok: true})
      global.aiTestUnit = {
        addFlips: empty,
        listFlips: async () => ({ok: true, total: 0, flips: []}),
        clearFlips: empty,
        run: empty,
      }
    }

    if (!global.toggleFullScreen) {
      global.toggleFullScreen = () => {}
    }

    if (!global.getZoomLevel) {
      global.getZoomLevel = () => 0
    }

    if (!global.setZoomLevel) {
      global.setZoomLevel = () => {}
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
