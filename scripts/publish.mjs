import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const packagesRoot = resolve(root, "packages")
const dryRun = process.env.EFFECT_STACK_PUBLISH_DRY_RUN === "1"

const npmEnvironment = { ...process.env }
delete npmEnvironment.NODE_AUTH_TOKEN
delete npmEnvironment.NPM_AUTH_TOKEN
delete npmEnvironment.NPM_TOKEN

const publishedVersions = (name) => {
  const result = spawnSync("npm", ["view", name, "versions", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: npmEnvironment
  })

  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`
    if (output.includes("E404")) return []
    process.stderr.write(output)
    process.exit(result.status ?? 1)
  }

  const versions = JSON.parse(result.stdout)
  return Array.isArray(versions) ? versions : [versions]
}

for (const directory of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue

  const packageRoot = resolve(packagesRoot, directory.name)
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"))
  if (manifest.private === true || publishedVersions(manifest.name).includes(manifest.version)) continue

  const artifactDirectory = mkdtempSync(join(tmpdir(), "effect-stack-publish-"))
  try {
    const packed = JSON.parse(execFileSync("pnpm", ["pack", "--pack-destination", artifactDirectory, "--json"], {
      cwd: packageRoot,
      encoding: "utf8"
    }))
    const args = [
      "publish",
      packed.filename,
      "--access",
      manifest.publishConfig?.access ?? "public",
      "--tag",
      "latest"
    ]
    if (dryRun) args.push("--dry-run", "--provenance=false")

    const published = spawnSync("npm", args, {
      cwd: packageRoot,
      env: npmEnvironment,
      stdio: "inherit"
    })
    if (published.status !== 0) process.exit(published.status ?? 1)

    process.stdout.write(`🦋  New tag: ${manifest.name}@${manifest.version}\n`)
  } finally {
    rmSync(artifactDirectory, { recursive: true, force: true })
  }
}
