import confetti from 'canvas-confetti'
import {getIdentityPublishedFlipsCount} from './identity'

export const onboardingPromotingStep = (step) => `${step}.promoting`
export const onboardingShowingStep = (step) => `${step}.showing`

export const shouldCreateFlips = (identity = {}) =>
  Boolean(identity.isValidated) &&
  Number(identity.requiredFlips) - getIdentityPublishedFlipsCount(identity) > 0

export function rewardWithConfetti(params) {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: {y: 0.6},
    ...params,
  })
}
