#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const rootDir = path.resolve(__dirname, '..')
const sourceDir = path.join(rootDir, 'vendor', 'idena.social-ui', 'dist')
const targetDir = path.join(rootDir, 'renderer', 'public', 'idena-social')

function copyRecursive(sourcePath, targetPath) {
  const stats = fs.statSync(sourcePath)

  if (stats.isDirectory()) {
    fs.mkdirSync(targetPath, {recursive: true})
    for (const entry of fs.readdirSync(sourcePath)) {
      copyRecursive(path.join(sourcePath, entry), path.join(targetPath, entry))
    }
    return
  }

  fs.mkdirSync(path.dirname(targetPath), {recursive: true})
  fs.copyFileSync(sourcePath, targetPath)
}

if (!fs.existsSync(sourceDir)) {
  console.error(
    `idena.social-ui build output not found at ${sourceDir}. Run npm run build --prefix vendor/idena.social-ui first.`
  )
  process.exit(1)
}

fs.rmSync(targetDir, {recursive: true, force: true})
copyRecursive(sourceDir, targetDir)

console.log(`Synced idena.social UI to ${targetDir}`)
