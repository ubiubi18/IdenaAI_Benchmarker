/* eslint-disable react/prop-types */
import React, {useCallback, useEffect, useState} from 'react'
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
  syncSharedGlobal,
} from '../shared/utils/shared-global'

function hasRealBridge(bridge = {}) {
  return Boolean(
    bridge && bridge.app && typeof bridge.app.reload === 'function'
  )
}

function syncLegacyBridgeGlobals(bridge = {}) {
  if (typeof window === 'undefined') {
    return false
  }

  const bridgeGlobals =
    bridge && bridge.globals && typeof bridge.globals === 'object'
      ? bridge.globals
      : {}

  if (!window.global) {
    window.global = window
  }

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
      reviewValidationReports: empty,
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

  if (!global.localAi) {
    const empty = async () => ({ok: false, status: 'unavailable'})
    global.localAi = {
      status: async () => ({
        available: false,
        running: false,
        sidecarReachable: false,
        sidecarModelCount: 0,
        lastError: 'Local AI bridge is not available in this build',
      }),
      start: empty,
      stop: async () => ({ok: true}),
      listModels: async () => ({ok: false, models: [], total: 0}),
      chat: empty,
      captionFlip: async () => ({ok: false, status: 'not_implemented'}),
      ocrImage: async () => ({ok: false, status: 'not_implemented'}),
      trainEpoch: async () => ({ok: false, status: 'not_implemented'}),
      loadTrainingCandidatePackage: empty,
      buildTrainingCandidatePackage: empty,
      updateTrainingCandidatePackageReview: empty,
      loadHumanTeacherPackage: empty,
      buildHumanTeacherPackage: empty,
      loadHumanTeacherDemoWorkspace: empty,
      loadHumanTeacherDeveloperSession: empty,
      loadHumanTeacherDemoTask: empty,
      loadHumanTeacherDeveloperTask: empty,
      loadHumanTeacherAnnotationWorkspace: empty,
      loadHumanTeacherAnnotationTask: empty,
      updateHumanTeacherPackageReview: empty,
      exportHumanTeacherTasks: empty,
      saveHumanTeacherAnnotationDraft: empty,
      saveHumanTeacherDemoDraft: empty,
      saveHumanTeacherDeveloperDraft: empty,
      finalizeHumanTeacherDeveloperChunk: empty,
      importHumanTeacherAnnotations: empty,
      captureFlip: () => {},
    }
  }

  if (!global.openExternal) {
    global.openExternal = () => Promise.resolve(false)
  }

  if (!global.clipboard) {
    global.clipboard = {
      readText: () => '',
      readImageDataUrl: () => null,
      writeImageDataUrl: () => false,
    }
  }

  if (!global.imageTools) {
    global.imageTools = {
      resizeDataUrl: () => null,
      createBlankDataUrl: () => null,
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

  if (bridgeGlobals.env) {
    global.env = bridgeGlobals.env
  }

  if (bridgeGlobals.logger) {
    global.logger = bridgeGlobals.logger
  }

  if (bridgeGlobals.openExternal) {
    global.openExternal = bridgeGlobals.openExternal
  }

  if (bridgeGlobals.aiSolver) {
    global.aiSolver = bridgeGlobals.aiSolver
  }

  if (bridgeGlobals.aiTestUnit) {
    global.aiTestUnit = bridgeGlobals.aiTestUnit
  }

  if (bridgeGlobals.localAi) {
    global.localAi = bridgeGlobals.localAi
  }

  syncSharedGlobal('env', global.env)
  syncSharedGlobal('logger', global.logger)
  syncSharedGlobal('openExternal', global.openExternal)
  syncSharedGlobal('aiSolver', global.aiSolver)
  syncSharedGlobal('aiTestUnit', global.aiTestUnit)
  syncSharedGlobal('localAi', global.localAi)
  syncSharedGlobal('appVersion', APP_VERSION_FALLBACK)
  syncSharedGlobal('isDev', false)
  syncSharedGlobal('isTest', false)
  syncSharedGlobal('isMac', false)
  syncSharedGlobal('locale', 'en')
  syncSharedGlobal('toggleFullScreen', global.toggleFullScreen)
  syncSharedGlobal('getZoomLevel', global.getZoomLevel)
  syncSharedGlobal('setZoomLevel', global.setZoomLevel)

  global.sub = (db, prefix, options) =>
    db && typeof db.sub === 'function' ? db.sub(prefix, options) : db

  if (bridge.clipboard) {
    global.clipboard = bridge.clipboard
  }

  if (bridge.image) {
    global.imageTools = bridge.image
  }

  const isBridgeReady = hasRealBridge(bridge)
  global.__idenaBridgeReady = isBridgeReady

  return isBridgeReady
}

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
  const [bridgeEpoch, setBridgeEpoch] = useState(0)

  if (typeof window !== 'undefined') {
    syncLegacyBridgeGlobals(window.idena || {})
  }

  const handleBridgeReady = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }

    const hadFallbackBridge = global.__idenaBridgeReady === false
    const isBridgeReady = syncLegacyBridgeGlobals(window.idena || {})

    if (hadFallbackBridge && isBridgeReady) {
      setBridgeEpoch((value) => value + 1)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    handleBridgeReady()
    window.addEventListener('idena-preload-ready', handleBridgeReady)

    return () => {
      window.removeEventListener('idena-preload-ready', handleBridgeReady)
    }
  }, [handleBridgeReady])

  return (
    <QueryClientProvider client={queryClient} key={bridgeEpoch}>
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
