/* eslint-disable react/prop-types */
import React from 'react'
import {Box, ListItem, Stack, Text, UnorderedList} from '@chakra-ui/react'
import {Dialog, DialogBody, DialogFooter} from './components'
import {PrimaryButton, SecondaryButton} from './button'

export function ManagedRuntimeTrustDialog({
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
  title = 'Trust managed on-device AI',
  confirmLabel = 'Trust and continue',
  runtimeName = 'managed on-device runtime',
  extraNote = '',
}) {
  const nextRuntimeName = String(runtimeName || 'managed on-device runtime')
    .trim()
    .replace(/\s+/gu, ' ')

  return (
    <Dialog
      isOpen={isOpen}
      onClose={isLoading ? undefined : onClose}
      shouldCloseOnEsc={!isLoading}
      shouldCloseOnOverlayClick={!isLoading}
      shouldShowCloseButton={!isLoading}
      size="lg"
      title={title}
    >
      <DialogBody>
        <Stack spacing={4}>
          <Text>
            IdenaAI can prepare the {nextRuntimeName} on this device, but that
            setup still installs pinned Python packages and runs pinned model
            code locally.
          </Text>

          <Box
            bg="gray.50"
            borderWidth="1px"
            borderColor="gray.100"
            p={4}
            rounded="md"
          >
            <UnorderedList spacing={2} pl={4} m={0}>
              <ListItem>
                downloads pinned runtime packages and the pinned{' '}
                {nextRuntimeName} snapshot into a private local cache
              </ListItem>
              <ListItem>
                verifies the trusted runtime files before startup
              </ListItem>
              <ListItem>
                runs the runtime on loopback only (`127.0.0.1`) behind a local
                auth token
              </ListItem>
              <ListItem>
                still executes the pinned model code locally, so only continue
                if you want this managed runtime on this machine
              </ListItem>
            </UnorderedList>
          </Box>

          {extraNote ? (
            <Text color="orange.600" fontSize="sm">
              {extraNote}
            </Text>
          ) : null}

          <Text color="muted" fontSize="sm">
            This approval is stored only on this device.
          </Text>
        </Stack>
      </DialogBody>
      <DialogFooter>
        <SecondaryButton isDisabled={isLoading} onClick={onClose}>
          Cancel
        </SecondaryButton>
        <PrimaryButton isLoading={isLoading} onClick={onConfirm}>
          {confirmLabel}
        </PrimaryButton>
      </DialogFooter>
    </Dialog>
  )
}
