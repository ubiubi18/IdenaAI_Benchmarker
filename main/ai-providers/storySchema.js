const STORY_PANEL_ROLES = ['before', 'trigger', 'reaction', 'after']

const STORY_COMPLIANCE_KEYS = [
  'keyword_relevance',
  'no_text_needed',
  'no_order_labels',
  'no_inappropriate_content',
  'single_story_only',
  'no_waking_up_template',
  'no_thumbs_up_down',
  'no_enumeration_logic',
  'no_screen_or_page_keyword_cheat',
  'causal_clarity',
  'consensus_clarity',
]

const STORY_OPTIONS_SCHEMA_NAME = 'idena_story_options_v2'
function normalizeStoryOptionCount(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return 2
  return Math.max(1, Math.min(2, parsed))
}

function createStoryOptionsJsonSchema(storyCount = 2) {
  const normalizedStoryCount = normalizeStoryOptionCount(storyCount)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['stories'],
    properties: {
      stories: {
        type: 'array',
        minItems: normalizedStoryCount,
        maxItems: normalizedStoryCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'story_summary',
            'panels',
            'compliance_report',
            'risk_flags',
            'revision_if_risky',
          ],
          properties: {
            title: {
              type: 'string',
              minLength: 1,
              maxLength: 64,
            },
            story_summary: {
              type: 'string',
              minLength: 10,
              maxLength: 220,
            },
            panels: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'panel',
                  'role',
                  'description',
                  'required_visibles',
                  'state_change_from_previous',
                ],
                properties: {
                  panel: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 4,
                  },
                  role: {
                    type: 'string',
                    enum: STORY_PANEL_ROLES,
                  },
                  description: {
                    type: 'string',
                    minLength: 12,
                    maxLength: 240,
                  },
                  required_visibles: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 5,
                    items: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 64,
                    },
                  },
                  state_change_from_previous: {
                    type: 'string',
                    minLength: 3,
                    maxLength: 140,
                  },
                },
              },
            },
            compliance_report: {
              type: 'object',
              additionalProperties: false,
              required: STORY_COMPLIANCE_KEYS,
              properties: STORY_COMPLIANCE_KEYS.reduce((acc, key) => {
                acc[key] = {
                  type: 'string',
                  enum: ['pass', 'fail'],
                }
                return acc
              }, {}),
            },
            risk_flags: {
              type: 'array',
              maxItems: 6,
              items: {
                type: 'string',
                minLength: 1,
                maxLength: 120,
              },
            },
            revision_if_risky: {
              type: 'string',
              maxLength: 320,
            },
          },
        },
      },
    },
  }
}

function toGeminiSchema(schema) {
  const source = schema && typeof schema === 'object' ? schema : {}
  const result = {}

  if (source.type) {
    result.type = String(source.type).trim().toUpperCase()
  }
  if (Array.isArray(source.required) && source.required.length > 0) {
    result.required = source.required.slice()
  }
  if (Array.isArray(source.enum) && source.enum.length > 0) {
    result.enum = source.enum.slice()
  }
  if (Number.isFinite(source.minLength)) {
    result.minLength = Number(source.minLength)
  }
  if (Number.isFinite(source.maxLength)) {
    result.maxLength = Number(source.maxLength)
  }
  if (Number.isFinite(source.minimum)) {
    result.minimum = Number(source.minimum)
  }
  if (Number.isFinite(source.maximum)) {
    result.maximum = Number(source.maximum)
  }
  if (Number.isFinite(source.minItems)) {
    result.minItems = Number(source.minItems)
  }
  if (Number.isFinite(source.maxItems)) {
    result.maxItems = Number(source.maxItems)
  }
  if (source.items && typeof source.items === 'object') {
    result.items = toGeminiSchema(source.items)
  }
  if (source.properties && typeof source.properties === 'object') {
    const propertyNames = Object.keys(source.properties)
    result.properties = propertyNames.reduce((acc, key) => {
      acc[key] = toGeminiSchema(source.properties[key])
      return acc
    }, {})
    result.propertyOrdering = propertyNames
  }

  return result
}

function createStoryOptionsOpenAiResponseFormat(storyCount = 2) {
  return {
    type: 'json_schema',
    json_schema: {
      name: STORY_OPTIONS_SCHEMA_NAME,
      strict: true,
      schema: createStoryOptionsJsonSchema(storyCount),
    },
  }
}

function createStoryOptionsGeminiResponseSchema(storyCount = 2) {
  return toGeminiSchema(createStoryOptionsJsonSchema(storyCount))
}

const STORY_OPTIONS_JSON_SCHEMA = createStoryOptionsJsonSchema(2)
const STORY_OPTIONS_OPENAI_RESPONSE_FORMAT =
  createStoryOptionsOpenAiResponseFormat(2)
const STORY_OPTIONS_GEMINI_RESPONSE_SCHEMA =
  createStoryOptionsGeminiResponseSchema(2)

function createValidationResult(errors) {
  const list = Array.isArray(errors) ? errors.filter(Boolean) : []
  return {
    ok: list.length === 0,
    errors: list,
    error: list[0] || '',
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasUnexpectedKeys(value, allowedKeys) {
  if (!isPlainObject(value)) return []
  return Object.keys(value).filter((key) => !allowedKeys.includes(key))
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validateStoryPanel(panel, storyIndex, panelIndex, errors) {
  const path = `stories[${storyIndex}].panels[${panelIndex}]`
  const allowedKeys = [
    'panel',
    'role',
    'description',
    'required_visibles',
    'state_change_from_previous',
  ]
  if (!isPlainObject(panel)) {
    errors.push(`${path} must be an object`)
    return
  }

  hasUnexpectedKeys(panel, allowedKeys).forEach((key) => {
    errors.push(`${path}.${key} is not allowed`)
  })

  const expectedPanelNumber = panelIndex + 1
  if (Number(panel.panel) !== expectedPanelNumber) {
    errors.push(`${path}.panel must equal ${expectedPanelNumber}`)
  }

  const expectedRole = STORY_PANEL_ROLES[panelIndex]
  if (String(panel.role || '').trim() !== expectedRole) {
    errors.push(`${path}.role must equal "${expectedRole}"`)
  }

  if (!isNonEmptyString(panel.description)) {
    errors.push(`${path}.description must be a non-empty string`)
  }

  if (!Array.isArray(panel.required_visibles)) {
    errors.push(`${path}.required_visibles must be an array`)
  } else {
    if (
      panel.required_visibles.length < 2 ||
      panel.required_visibles.length > 5
    ) {
      errors.push(`${path}.required_visibles must contain 2 to 5 items`)
    }
    panel.required_visibles.forEach((item, index) => {
      if (!isNonEmptyString(item)) {
        errors.push(
          `${path}.required_visibles[${index}] must be a non-empty string`
        )
      }
    })
  }

  if (!isNonEmptyString(panel.state_change_from_previous)) {
    errors.push(`${path}.state_change_from_previous must be a non-empty string`)
  }
}

function validateComplianceReport(report, storyIndex, errors) {
  const path = `stories[${storyIndex}].compliance_report`
  if (!isPlainObject(report)) {
    errors.push(`${path} must be an object`)
    return
  }

  hasUnexpectedKeys(report, STORY_COMPLIANCE_KEYS).forEach((key) => {
    errors.push(`${path}.${key} is not allowed`)
  })

  STORY_COMPLIANCE_KEYS.forEach((key) => {
    const value = String(report[key] || '').trim()
    if (!['pass', 'fail'].includes(value)) {
      errors.push(`${path}.${key} must be "pass" or "fail"`)
    }
  })
}

function validateStoryItem(item, storyIndex, errors) {
  const path = `stories[${storyIndex}]`
  const allowedKeys = [
    'title',
    'story_summary',
    'panels',
    'compliance_report',
    'risk_flags',
    'revision_if_risky',
  ]
  if (!isPlainObject(item)) {
    errors.push(`${path} must be an object`)
    return
  }

  hasUnexpectedKeys(item, allowedKeys).forEach((key) => {
    errors.push(`${path}.${key} is not allowed`)
  })

  if (!isNonEmptyString(item.title)) {
    errors.push(`${path}.title must be a non-empty string`)
  }
  if (!isNonEmptyString(item.story_summary)) {
    errors.push(`${path}.story_summary must be a non-empty string`)
  }
  if (!Array.isArray(item.panels) || item.panels.length !== 4) {
    errors.push(`${path}.panels must contain exactly 4 panels`)
  } else {
    item.panels.forEach((panel, panelIndex) =>
      validateStoryPanel(panel, storyIndex, panelIndex, errors)
    )
  }

  validateComplianceReport(item.compliance_report, storyIndex, errors)

  if (!Array.isArray(item.risk_flags)) {
    errors.push(`${path}.risk_flags must be an array`)
  } else if (item.risk_flags.length > 6) {
    errors.push(`${path}.risk_flags must contain at most 6 items`)
  } else {
    item.risk_flags.forEach((flag, index) => {
      if (!isNonEmptyString(flag)) {
        errors.push(`${path}.risk_flags[${index}] must be a non-empty string`)
      }
    })
  }

  if (typeof item.revision_if_risky !== 'string') {
    errors.push(`${path}.revision_if_risky must be a string`)
  }
}

function validateStoryOptionsPayload(value, storyCount = 2) {
  const errors = []
  const normalizedStoryCount = normalizeStoryOptionCount(storyCount)
  if (!isPlainObject(value)) {
    return createValidationResult(['root payload must be an object'])
  }

  hasUnexpectedKeys(value, ['stories']).forEach((key) => {
    errors.push(`root.${key} is not allowed`)
  })

  if (
    !Array.isArray(value.stories) ||
    value.stories.length !== normalizedStoryCount
  ) {
    errors.push(
      `root.stories must contain exactly ${normalizedStoryCount} story option${
        normalizedStoryCount === 1 ? '' : 's'
      }`
    )
  } else {
    value.stories.forEach((story, storyIndex) =>
      validateStoryItem(story, storyIndex, errors)
    )
  }

  return createValidationResult(errors)
}

module.exports = {
  STORY_COMPLIANCE_KEYS,
  STORY_OPTIONS_GEMINI_RESPONSE_SCHEMA,
  STORY_OPTIONS_JSON_SCHEMA,
  STORY_OPTIONS_OPENAI_RESPONSE_FORMAT,
  STORY_OPTIONS_SCHEMA_NAME,
  STORY_PANEL_ROLES,
  createStoryOptionsGeminiResponseSchema,
  createStoryOptionsJsonSchema,
  createStoryOptionsOpenAiResponseFormat,
  normalizeStoryOptionCount,
  validateStoryOptionsPayload,
}
