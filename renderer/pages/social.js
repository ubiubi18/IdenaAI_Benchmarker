import React from 'react'
import SocialDesktopEmbed from '../shared/components/social-desktop-embed'

export default function SocialPage() {
  return (
    <SocialDesktopEmbed
      title="idena.social"
      description="Local bundled `idena.social` UI inside idena-desktop. Posting always uses your own node RPC. Community history now defaults to the official Idena indexer because node RPC-only scanning and node-local IPFS retrieval can hide older posts that still exist on-chain."
      iframeTitle="idena.social"
    />
  )
}
