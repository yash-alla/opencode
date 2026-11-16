export * as ToolSearch from "./search.js"

import { ToolFailure } from "@opencode/ai/effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import path from "path"
import { Environment } from "../environment/index.js"
import { FileSystem } from "../filesystem.js"

const isGlob = (value: string) => /[*?[\]{}]/.test(value)

/**
 * Resolves an absolute glob pattern into an anchored relative glob pattern and concrete search path.
 * If the pattern is relative or already anchored to the root search directory, it is preserved.
 */
export const resolveGlobPattern = (pattern: string, baseDirectory?: string, home = Global.Path.home) => {
  const expanded =
    pattern === "~"
      ? home
      : pattern.startsWith("~/") || (process.platform === "win32" && pattern.startsWith("~\\"))
        ? path.join(home, pattern.slice(2))
        : FSUtil.windowsPath(pattern)

  const isAbsolute = path.isAbsolute(expanded) || path.posix.isAbsolute(expanded) || path.win32.isAbsolute(expanded)
  if (!isAbsolute) return { path: baseDirectory, pattern }

  const posixPattern = expanded.replaceAll("\\", "/")
  const withoutLeadingSlash = posixPattern.replace(/^\/+/, "")
  const firstSlash = withoutLeadingSlash.indexOf("/")
  const firstSegment = firstSlash === -1 ? withoutLeadingSlash : withoutLeadingSlash.slice(0, firstSlash)
  if (isGlob(firstSegment)) return { path: baseDirectory, pattern: `/${withoutLeadingSlash}` }

  if (baseDirectory) {
    const rel = path.relative(baseDirectory, expanded)
    const isOutside = rel.startsWith("..") || path.isAbsolute(rel)
    if (!isOutside) {
      const relPosix = rel.replaceAll("\\", "/")
      return {
        path: baseDirectory,
        pattern: `/${relPosix.replace(/^\/+/, "")}`,
      }
    }
  }

  const parsed = path.parse(expanded)
  const parts = expanded.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean)
  const index = parts.findIndex(isGlob)
  const rootParts = index === -1 ? parts.slice(0, -1) : parts.slice(0, index)
  const patternParts = index === -1 ? parts.slice(-1) : parts.slice(index)

  return {
    path: path.join(parsed.root, ...rootParts),
    pattern: patternParts.length === 0 ? "/*" : `/${patternParts.join("/")}`,
  }
}

export const pathType = (files: Environment.Files, absolute: string, display: string) =>
  Environment.typeFollowing(files, absolute).pipe(
    Effect.catchTag("Environment.NotFound", () =>
      Effect.fail(new ToolFailure({ message: `Search path does not exist: ${display}` })),
    ),
  )

// Fetches one result past the limit so truncation can be reported without a second search.
export const bounded = <A, E, R>(limit: number, search: (limit: number) => Effect.Effect<readonly A[], E, R>) =>
  search(limit + 1).pipe(
    Effect.timeoutOrElse({
      duration: FileSystem.DEFAULT_SEARCH_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          new ToolFailure({
            message: `Search timed out after ${FileSystem.DEFAULT_SEARCH_TIMEOUT_MS / 1_000} seconds. Consider using a more specific path or pattern.`,
          }),
        ),
    }),
    Effect.map((items) => ({ items: items.slice(0, limit), truncated: items.length > limit })),
  )
