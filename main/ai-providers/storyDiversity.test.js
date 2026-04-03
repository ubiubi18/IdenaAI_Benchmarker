const {
  evaluateStoryDiversityPair,
  selectStoryOptionPair,
} = require('./storyDiversity')

function makeStory({
  id,
  title,
  score,
  panels,
  source = 'provider_story_options',
}) {
  const roles = ['before', 'trigger', 'reaction', 'after']
  return {
    id,
    title,
    panels: panels.slice(0, 4),
    panelDetails: panels.slice(0, 4).map((description, index) => ({
      panel: index + 1,
      role: roles[index],
      description,
      requiredVisibles: [],
      stateChangeFromPrevious:
        index === 0 ? 'n/a' : `Visible change in panel ${index + 1}.`,
    })),
    candidateSource: source,
    qualityReport: {
      ok: true,
      score,
    },
  }
}

describe('story diversity reranking', () => {
  test('reranks near-duplicate high-quality options below a more diverse valid pair', () => {
    const hallwayCup = makeStory({
      id: 'hallway-cup',
      title: 'Hallway cup fright',
      score: 96,
      panels: [
        'A calm person carries a cup through a hallway while a ghost is faintly visible.',
        'The ghost moves fully into view and the person jolts in shock as the cup slips.',
        'The cup hits the floor and water spreads while the ghost remains visible.',
        'The startled person backs away from the puddle while the ghost stays in the hallway.',
      ],
    })
    const hallwayLamp = makeStory({
      id: 'hallway-lamp',
      title: 'Hallway lamp fright',
      score: 95,
      panels: [
        'A calm person reads beside a hallway table lamp while a ghost is faintly visible.',
        'The ghost moves fully into view and the person jolts in shock as the lamp tips from the table.',
        'The lamp crashes to the floor while the ghost remains visible in the hallway.',
        'The startled person backs away from the broken lamp while the ghost stays in the hallway.',
      ],
    })
    const basementDoor = makeStory({
      id: 'basement-door',
      title: 'Basement door scare',
      score: 91,
      panels: [
        'A person reaches for a basement door at the top of a stairwell with a flashlight.',
        'The door swings open, a ghost appears on the stairs, and the person recoils in shock.',
        'The flashlight drops and its beam swings across the stairs under the ghost.',
        'The person presses against the wall while the flashlight lies on the stairs and the ghost remains visible.',
      ],
    })

    const nearDuplicateScore = evaluateStoryDiversityPair(
      hallwayCup,
      hallwayLamp
    )
    const diverseScore = evaluateStoryDiversityPair(hallwayCup, basementDoor)
    const selection = selectStoryOptionPair([
      hallwayCup,
      hallwayLamp,
      basementDoor,
    ])

    expect(diverseScore.score).toBeGreaterThan(nearDuplicateScore.score)
    expect(selection.selectedStories.map((story) => story.id)).toEqual(
      expect.arrayContaining(['hallway-cup', 'basement-door'])
    )
    expect(selection.selectedStories.map((story) => story.id)).not.toEqual([
      'hallway-cup',
      'hallway-lamp',
    ])
  })

  test('diversity does not override a large quality gap', () => {
    const workshopA = makeStory({
      id: 'workshop-a',
      title: 'Workshop carving A',
      score: 97,
      panels: [
        'A clown stands in a bright workshop with a chainsaw and a wooden log.',
        'The clown starts cutting the log with the chainsaw on the workbench.',
        'Wood chips scatter as the clown shapes the log into a sculpture.',
        'The clown sets down the chainsaw and shows the finished wooden sculpture.',
      ],
    })
    const workshopB = makeStory({
      id: 'workshop-b',
      title: 'Workshop carving B',
      score: 94,
      panels: [
        'A clown stands in the same bright workshop with a chainsaw and a wood block.',
        'The clown lowers the chainsaw into the wood block on the same workbench.',
        'Wood chips scatter as the clown shapes the block into a figure.',
        'The clown shows the finished wooden figure with the chainsaw resting nearby.',
      ],
    })
    const outdoorLow = makeStory({
      id: 'outdoor-low',
      title: 'Outdoor carving',
      score: 68,
      panels: [
        'A clown walks to an outdoor carving booth with a chainsaw and a wood block.',
        'The clown starts the chainsaw beside the booth and begins cutting the wood block.',
        'The carving takes form as chips scatter around the outdoor booth.',
        'The clown presents the finished carving beside the booth with the chainsaw set aside.',
      ],
    })

    const selection = selectStoryOptionPair([workshopA, workshopB, outdoorLow])
    const lowQualityPair = selection.pairwiseScores.find((pair) =>
      pair.storyIds.some((storyId) => storyId.endsWith('outdoor-low'))
    )

    expect(selection.selectedStories.map((story) => story.id)).toEqual([
      'workshop-a',
      'workshop-b',
    ])
    expect(lowQualityPair.qualityFloorPenalty).toBeGreaterThan(10)
  })
})
