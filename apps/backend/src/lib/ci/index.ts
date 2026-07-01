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

export const fetchJobTrace = (
  source: CiSourceInfo,
  pipelineId: string,
): Promise<string> => {
  switch (source.provider) {
    case 'gitlab':
      return getGitLabJobTrace(source.url, source.accessToken, pipelineId)
    case 'github':
      // GitHub does not have a direct trace endpoint analogous to GitLab
      return Promise.resolve('')
    case 'bitbucket':
      return Promise.resolve('')
  }
}

// Strip ANSI escape codes and parse OpenTofu/Terraform "Outputs:" section
export const parseTofuOutputs = (trace: string): Record<string, string> => {
  // eslint-disable-next-line no-control-regex
  const stripped = trace.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
  const lines = stripped.split('\n')
  const outputs: Record<string, string> = {}

  let inOutputs = false
  for (const line of lines) {
    if (/^Outputs:/.test(line.trim())) {
      inOutputs = true
      continue
    }
    if (inOutputs) {
      const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*"(.*)"$/)
      if (match) {
        outputs[match[1]] = match[2]
      } else if (line.trim() === '' || /^[A-Z]/.test(line.trim())) {
        // empty line or new section header ends outputs block
        if (line.trim() !== '') inOutputs = false
      }
    }
  }
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
