import type { CiProvider, CiProject, CiBranch, CiFile } from '@open-hybrid-cloud/types'
import {
  triggerGitLabPipeline,
  getGitLabJobTrace,
  listGitLabProjects,
  listGitLabBranches,
  listGitLabFiles,
  getGitLabFileContent,
} from './gitlab'
import {
  triggerGitHubWorkflow,
  listGitHubRepos,
  listGitHubBranches,
  listGitHubFiles,
  getGitHubFileContent,
} from './github'
import {
  triggerBitbucketPipeline,
  listBitbucketRepos,
  listBitbucketBranches,
  listBitbucketFiles,
  getBitbucketFileContent,
} from './bitbucket'

export type CiSourceInfo = {
  url: string
  accessToken: string
  provider: CiProvider
}

export const triggerPipeline = (
  source: CiSourceInfo,
  webhookUrl: string,
  webhookToken: string,
  variables: Record<string, string>,
): Promise<string> => {
  switch (source.provider) {
    case 'gitlab':
      return triggerGitLabPipeline(webhookUrl, webhookToken, variables)
    case 'github':
      return triggerGitHubWorkflow(
        webhookUrl,
        source.accessToken,
        variables['WORKFLOW'] ?? 'main.yml',
        variables['BRANCH'] ?? 'main',
        variables,
      )
    case 'bitbucket':
      return triggerBitbucketPipeline(
        webhookUrl,
        source.accessToken,
        variables['BRANCH'] ?? 'main',
        variables,
      )
  }
}

/**
 * Can this provider's job log be read back?
 *
 * Only GitLab, today. That matters more than it looks: the apply log is the only
 * channel by which a deployment reports its Terraform outputs, so on GitHub and
 * Bitbucket an element never gets any — and nothing anywhere said so, which made it
 * look like the templates were at fault. Issue #97.
 *
 * Implementing the other two is real work rather than a missing case: GitHub serves
 * run logs as a redirect to a ZIP archive (needs an unzip dependency), and Bitbucket
 * needs the pipeline's steps enumerated before each step's log can be fetched.
 */
export const supportsJobTrace = (provider: CiSourceInfo['provider']): boolean =>
  provider === 'gitlab'

export const fetchJobTrace = (
  source: CiSourceInfo,
  pipelineId: string,
): Promise<string> => {
  switch (source.provider) {
    case 'gitlab':
      return getGitLabJobTrace(source.url, source.accessToken, pipelineId)
    case 'github':
    case 'bitbucket':
      // See supportsJobTrace: callers should check first and say why, rather than
      // treating an empty trace as "this deployment produced no outputs".
      return Promise.resolve('')
  }
}

/**
 * Parse the `Outputs:` block of an OpenTofu/Terraform apply log.
 *
 * The platform stores whatever this returns on the infrastructure element, and it
 * is the only channel by which a deployment can tell the portal anything — an
 * endpoint, a generated name, a connection string. So dropping a value silently is
 * the worst thing this function can do, and it used to drop a lot: it accepted only
 * `name = "quoted string"`, which meant numbers, booleans, lists, maps and
 * `<sensitive>` markers all vanished without trace. Issue #97.
 *
 * What is deliberately NOT parsed into structure: complex values are kept as the
 * text Terraform printed, joined on one line. The consumer is a key/value display
 * and a CSV column, and inventing a JSON shape here would be a guess about what a
 * template meant.
 */
export const parseTofuOutputs = (trace: string): Record<string, string> => {
  // eslint-disable-next-line no-control-regex
  const stripped = trace.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
  const lines = stripped.split('\n')
  const outputs: Record<string, string> = {}

  let inOutputs = false
  /** Set while a value spans several lines (a list, a map, a heredoc). */
  let pending: { name: string; parts: string[]; depth: number } | null = null

  const finish = () => {
    if (!pending) return
    // Collapse the whitespace Terraform uses for indentation; the value is shown
    // in a table cell, not in a code block.
    outputs[pending.name] = pending.parts.join(' ').replace(/\s+/g, ' ').trim()
    pending = null
  }

  const unquote = (value: string): string =>
    value.startsWith('"') && value.endsWith('"') && value.length >= 2 ? value.slice(1, -1) : value

  const depthOf = (text: string): number => {
    let depth = 0
    for (const char of text) {
      if (char === '[' || char === '{' || char === '(') depth++
      if (char === ']' || char === '}' || char === ')') depth--
    }
    return depth
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!inOutputs) {
      if (/^Outputs:/.test(trimmed)) inOutputs = true
      continue
    }

    if (pending) {
      pending.parts.push(trimmed)
      pending.depth += depthOf(trimmed)
      if (pending.depth <= 0) finish()
      continue
    }

    // A blank line inside the block is just spacing after the header.
    if (trimmed === '') continue

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) {
      // Not an assignment and not blank: the outputs block has ended (a warning,
      // a summary line, the next section).
      break
    }

    const [, name, rawValue] = match
    const value = rawValue.trim()

    // An opening bracket that is not closed on this line starts a multi-line value.
    if (depthOf(value) > 0) {
      pending = { name, parts: [value], depth: depthOf(value) }
      continue
    }

    // `<sensitive>` is recorded rather than dropped: "there is a value here and it
    // is not being shown" is information, and a missing key looks like a template
    // that forgot to declare the output.
    outputs[name] = unquote(value)
  }

  finish()
  return outputs
}

export const listProjects = (
  source: CiSourceInfo,
  search?: string,
): Promise<CiProject[]> => {
  switch (source.provider) {
    case 'gitlab':
      return listGitLabProjects(source.url, source.accessToken, search)
    case 'github':
      return listGitHubRepos(source.url, source.accessToken, search)
    case 'bitbucket':
      return listBitbucketRepos(source.url, source.accessToken, search)
  }
}

export const listBranches = (
  source: CiSourceInfo,
  projectId: string,
): Promise<CiBranch[]> => {
  switch (source.provider) {
    case 'gitlab':
      return listGitLabBranches(source.url, source.accessToken, projectId)
    case 'github':
      return listGitHubBranches(source.url, source.accessToken, projectId)
    case 'bitbucket':
      return listBitbucketBranches(source.url, source.accessToken, projectId)
  }
}

export const listFiles = (
  source: CiSourceInfo,
  projectId: string,
  branch: string,
  path?: string,
): Promise<CiFile[]> => {
  const normalizedPath = path ?? ''
  switch (source.provider) {
    case 'gitlab':
      return listGitLabFiles(source.url, source.accessToken, projectId, branch, normalizedPath)
    case 'github':
      return listGitHubFiles(source.url, source.accessToken, projectId, branch, normalizedPath)
    case 'bitbucket':
      return listBitbucketFiles(source.url, source.accessToken, projectId, branch, normalizedPath)
  }
}

export const getFileContent = (
  source: CiSourceInfo,
  projectId: string,
  branch: string,
  filePath: string,
): Promise<string> => {
  switch (source.provider) {
    case 'gitlab':
      return getGitLabFileContent(source.url, source.accessToken, projectId, branch, filePath)
    case 'github':
      return getGitHubFileContent(source.url, source.accessToken, projectId, branch, filePath)
    case 'bitbucket':
      return getBitbucketFileContent(source.url, source.accessToken, projectId, branch, filePath)
  }
}
