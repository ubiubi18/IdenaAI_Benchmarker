function canUseBrowserDevLocalAiBridge() {
  if (typeof window === 'undefined') {
    return false
  }

  const hostname = String(window.location?.hostname || '')
    .trim()
    .toLowerCase()

  return (
    process.env.NODE_ENV !== 'production' &&
    ['127.0.0.1', 'localhost'].includes(hostname)
  )
}

async function invokeBrowserDevLocalAi(method, payload) {
  let nextPayload = {value: payload}

  if (typeof payload === 'undefined') {
    nextPayload = {}
  } else if (payload && typeof payload === 'object') {
    nextPayload = payload
  }

  const response = await fetch(`/api/local-ai/${encodeURIComponent(method)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(nextPayload),
  })

  let data = null

  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    throw new Error(
      String(
        data?.lastError ||
          data?.error ||
          `Local AI browser dev bridge request failed for ${method}`
      ).trim()
    )
  }

  return data
}

export function getBrowserDevLocalAiBridge() {
  if (!canUseBrowserDevLocalAiBridge()) {
    return null
  }

  if (window.__idenaBrowserDevLocalAiBridge) {
    return window.__idenaBrowserDevLocalAiBridge
  }

  const invoke = (method) => (payload) =>
    invokeBrowserDevLocalAi(method, payload)

  const bridge = Object.freeze({
    bridgeMode: 'browser_dev_api',
    status: invoke('status'),
    getDeveloperTelemetry: invoke('getDeveloperTelemetry'),
    start: invoke('start'),
    stop: invoke('stop'),
    listModels: invoke('listModels'),
    chat: invoke('chat'),
    checkFlipSequence: invoke('checkFlipSequence'),
    flipToText: invoke('flipToText'),
    captionFlip: invoke('captionFlip'),
    ocrImage: invoke('ocrImage'),
    trainEpoch: invoke('trainEpoch'),
    importAdapterArtifact: invoke('importAdapterArtifact'),
    registerAdapterArtifact: invoke('registerAdapterArtifact'),
    loadAdapterArtifact: invoke('loadAdapterArtifact'),
    buildManifest: invoke('buildManifest'),
    loadTrainingCandidatePackage: invoke('loadTrainingCandidatePackage'),
    loadHumanTeacherPackage: invoke('loadHumanTeacherPackage'),
    buildTrainingCandidatePackage: invoke('buildTrainingCandidatePackage'),
    buildHumanTeacherPackage: invoke('buildHumanTeacherPackage'),
    updateTrainingCandidatePackageReview: invoke(
      'updateTrainingCandidatePackageReview'
    ),
    updateHumanTeacherPackageReview: invoke('updateHumanTeacherPackageReview'),
    loadHumanTeacherDemoWorkspace: invoke('loadHumanTeacherDemoWorkspace'),
    loadHumanTeacherDeveloperSession: invoke(
      'loadHumanTeacherDeveloperSession'
    ),
    loadHumanTeacherDeveloperSessionState: invoke(
      'loadHumanTeacherDeveloperSessionState'
    ),
    stopHumanTeacherDeveloperRun: invoke('stopHumanTeacherDeveloperRun'),
    updateHumanTeacherDeveloperRunControls: invoke(
      'updateHumanTeacherDeveloperRunControls'
    ),
    loadHumanTeacherDeveloperComparisonExamples: invoke(
      'loadHumanTeacherDeveloperComparisonExamples'
    ),
    exportHumanTeacherDeveloperBundle: invoke(
      'exportHumanTeacherDeveloperBundle'
    ),
    loadHumanTeacherDemoTask: invoke('loadHumanTeacherDemoTask'),
    loadHumanTeacherDeveloperTask: invoke('loadHumanTeacherDeveloperTask'),
    loadHumanTeacherAnnotationWorkspace: invoke(
      'loadHumanTeacherAnnotationWorkspace'
    ),
    loadHumanTeacherAnnotationTask: invoke('loadHumanTeacherAnnotationTask'),
    exportHumanTeacherTasks: invoke('exportHumanTeacherTasks'),
    saveHumanTeacherAnnotationDraft: invoke('saveHumanTeacherAnnotationDraft'),
    saveHumanTeacherDemoDraft: invoke('saveHumanTeacherDemoDraft'),
    saveHumanTeacherDeveloperDraft: invoke('saveHumanTeacherDeveloperDraft'),
    finalizeHumanTeacherDemoChunk: invoke('finalizeHumanTeacherDemoChunk'),
    finalizeHumanTeacherDeveloperChunk: invoke(
      'finalizeHumanTeacherDeveloperChunk'
    ),
    runHumanTeacherDeveloperComparison: invoke(
      'runHumanTeacherDeveloperComparison'
    ),
    importHumanTeacherAnnotations: invoke('importHumanTeacherAnnotations'),
    captureFlip: invoke('captureFlip'),
  })

  window.__idenaBrowserDevLocalAiBridge = bridge
  return bridge
}
