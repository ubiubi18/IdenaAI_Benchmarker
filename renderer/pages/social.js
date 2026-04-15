import React from 'react'
import SocialDesktopEmbed from '../shared/components/social-desktop-embed'

export default function SocialPage() {
  return (
    <SocialDesktopEmbed
      title="idena.social"
      description="Local bundled `idena.social` UI inside idena-desktop. Posting always uses your own node RPC. Community history now defaults to the official Idena indexer as a read-only fallback because node RPC-only scanning is often too narrow for the full feed."
      iframeTitle="idena.social"
    />
  )
}
