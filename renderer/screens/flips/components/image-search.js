/* eslint-disable react/prop-types */
import React from 'react'
import {
  Box,
  Center,
  Image,
  InputGroup,
  InputLeftElement,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {useMachine} from '@xstate/react'
import {PrimaryButton, SecondaryButton} from '../../../shared/components/button'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  Input,
} from '../../../shared/components/components'
import {eitherState} from '../../../shared/utils/utils'
import {FillCenter} from '../../oracles/components'
import {SearchIcon} from '../../../shared/components/icons'
import {imageSearchMachine} from '../machines'
import {useSettingsState} from '../../../shared/providers/settings-context'

const AI_IMAGE_SEARCH_KEY_REQUIRED_ERROR =
  'this option is only available for users who provide an API key for a payed AI provider'

function buildProviderConfig(provider, settings = {}) {
  if (provider !== 'openai-compatible') {
    return null
  }

  return {
    name: settings.customProviderName,
    baseUrl: settings.customProviderBaseUrl,
    chatPath: settings.customProviderChatPath,
  }
}

export function ImageSearchDialog({onPick, onClose, onError, ...props}) {
  const {t} = useTranslation()
  const settings = useSettingsState()
  const aiSolverSettings = React.useMemo(
    () => ({
      provider: 'openai',
      model: 'gpt-4o-mini',
      ...(settings && settings.aiSolver ? settings.aiSolver : {}),
    }),
    [settings]
  )
  const [searchMode, setSearchMode] = React.useState('web')

  const searchInputRef = React.useRef()

  const [current, send] = useMachine(imageSearchMachine, {
    actions: {
      onError: (_, event) => {
        const message =
          (event &&
            event.data &&
            (event.data.message || event.data.toString?.())) ||
          t('Image search failed')
        onError(message)
      },
    },
  })

  const {images, query, selectedImage} = current.context

  React.useEffect(() => {
    send('SET_AI_META', {
      provider: aiSolverSettings.provider,
      model: aiSolverSettings.model,
      providerConfig: buildProviderConfig(
        aiSolverSettings.provider,
        aiSolverSettings
      ),
    })
  }, [aiSolverSettings, send])

  const activateAiMode = async () => {
    try {
      if (
        !global.aiSolver ||
        typeof global.aiSolver.hasProviderKey !== 'function'
      ) {
        throw new Error(AI_IMAGE_SEARCH_KEY_REQUIRED_ERROR)
      }

      const keyState = await global.aiSolver.hasProviderKey({
        provider: aiSolverSettings.provider,
      })

      if (!keyState || !keyState.hasKey) {
        throw new Error(AI_IMAGE_SEARCH_KEY_REQUIRED_ERROR)
      }

      setSearchMode('ai')
      send('SET_MODE', {mode: 'ai'})
    } catch {
      onError(AI_IMAGE_SEARCH_KEY_REQUIRED_ERROR)
      setSearchMode('web')
      send('SET_MODE', {mode: 'web'})
    }
  }

  return (
    <Dialog
      size="440"
      initialFocusRef={searchInputRef}
      closeOnOverlayClick={false}
      onClose={onClose}
      {...props}
    >
      <DialogBody display="flex">
        <Stack minH="sm" maxH="sm" spacing={4} flex={1}>
          <Stack
            isInline
            as="form"
            onSubmit={(e) => {
              e.preventDefault()
              send('SEARCH')
            }}
          >
            <InputGroup w="full">
              <InputLeftElement w={5} h={5} top="1.5" left={3}>
                <SearchIcon boxSize="5" color="gray.100" />
              </InputLeftElement>
              <Input
                ref={searchInputRef}
                type="search"
                value={query}
                placeholder={t('Search the picture on the web')}
                bg="gray.50"
                pl={10}
                onChange={(e) => {
                  send('TYPE', {query: e.target.value})
                }}
              />
            </InputGroup>
            <SecondaryButton
              type="button"
              onClick={() => {
                setSearchMode('web')
                send('SET_MODE', {mode: 'web'})
              }}
            >
              {t('Web')}
            </SecondaryButton>
            <SecondaryButton type="button" onClick={activateAiMode}>
              {t('AI image search')}
            </SecondaryButton>
            <PrimaryButton type="submit">Search</PrimaryButton>
          </Stack>
          <Text fontSize="xs" color="muted">
            {searchMode === 'ai'
              ? t(
                  'AI image search mode: prompt text is sent to your configured AI provider.'
                )
              : t('Web image search mode: DuckDuckGo with fallback providers.')}
          </Text>

          {eitherState(current, 'idle') && (
            <FillCenter>
              <Stack spacing={4} align="center" w="3xs">
                <Box p={3}>
                  <SearchIcon boxSize="14" color="gray.300" />
                </Box>
                <Text color="muted" textAlign="center" w="full">
                  {searchMode === 'ai'
                    ? t('Type a keyword or full prompt to generate AI images.')
                    : t(
                        'Type your search in the box above to find images using search box'
                      )}
                </Text>
              </Stack>
            </FillCenter>
          )}

          {eitherState(current, 'done') && (
            <SimpleGrid
              columns={4}
              spacing={2}
              overflow="auto"
              px="8"
              sx={{
                marginInlineStart: '-32px !important',
                marginInlineEnd: '-32px !important',
              }}
            >
              {images.map(({thumbnail, image}, idx) => (
                <Center
                  key={`${image}-${idx}`}
                  h="88px"
                  w="88px"
                  bg={thumbnail === selectedImage ? 'blue.032' : 'white'}
                  borderColor={
                    thumbnail === selectedImage ? 'blue.500' : 'gray.50'
                  }
                  borderWidth={1}
                  borderRadius="md"
                  overflow="hidden"
                  transition="all 0.6s cubic-bezier(0.16, 1, 0.3, 1)"
                  onClick={() => {
                    send('PICK', {image: thumbnail})
                  }}
                  onDoubleClick={() => {
                    onPick(selectedImage)
                  }}
                >
                  <Image
                    src={thumbnail}
                    objectFit="contain"
                    objectPosition="center"
                    borderColor={
                      thumbnail === selectedImage ? 'blue.500' : 'transparent'
                    }
                    borderWidth={1}
                    borderRadius="md"
                    w="88px"
                  />
                </Center>
              ))}
            </SimpleGrid>
          )}
          {eitherState(current, 'searching') && (
            <FillCenter>
              <Spinner color="blue.500" />
            </FillCenter>
          )}
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton onClick={onClose}>{t('Cancel')}</SecondaryButton>
        <PrimaryButton
          onClick={() => {
            onPick(selectedImage)
          }}
        >
          {t('Select')}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}
