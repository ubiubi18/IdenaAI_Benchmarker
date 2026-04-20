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
}) {
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
            IdenaAI can prepare the managed Molmo2-O runtime on this device, but
            that setup still installs pinned Python packages and runs pinned
            model code locally.
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
                downloads pinned runtime packages and a pinned Molmo2-O model
                revision into a private local cache
              </ListItem>
              <ListItem>
                verifies the trusted Molmo2 executable files before startup
              </ListItem>
              <ListItem>
                runs the runtime on loopback only (`127.0.0.1`) behind a local
                auth token
              </ListItem>
              <ListItem>
                still executes the pinned Molmo2 Python code locally, so only
                continue if you want this managed runtime on this machine
              </ListItem>
            </UnorderedList>
          </Box>

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
