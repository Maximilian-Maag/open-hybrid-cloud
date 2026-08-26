import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ci', () => ({
  listFiles: vi.fn(),
  getFileContent: vi.fn(),
}))

import { listFiles, getFileContent, type CiSourceInfo } from '@/lib/ci'
import { scanTemplate, resolveRepoPath, MAX_MODULE_DEPTH } from './templateImport'

/**
 * Reading a template's inputs out of a repository (reported: "I cannot import
 * product parameters from a git repo directly", and templates "made of modules"
 * importing nothing).
 *
 * The previous import read exactly one file — `templates/<name>/variables.tf` on
 * `main` — which is why a root that wires modules together found no variables at
 * all: it declares few of its own.
 */

const source: CiSourceInfo = { url: 'https://git.example.com', accessToken: 'tok', provider: 'gitlab' }
const listMock = vi.mocked(listFiles)
const contentMock = vi.mocked(getFileContent)

/** A repository as `{ 'dir/file.tf': contents }`, served to both CI mocks. */
function repo(files: Record<string, string>) {
  listMock.mockImplementation(async (_s, _p, _r, path) => {
    const prefix = path ? `${path}/` : ''
    return Object.keys(files)
      .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/'))
      .map((f) => ({ name: f.slice(prefix.length), path: f, type: 'blob' as const }))
  })
  contentMock.mockImplementation(async (_s, _p, _r, file) => {
    const found = files[file as string]
    if (found === undefined) throw new Error(`404 ${file}`)
    return found
  })
}

beforeEach(() => {
  listMock.mockReset()
  contentMock.mockReset()
})

describe('resolveRepoPath', () => {
  it.each([
    ['templates/vm', './modules/net', 'templates/vm/modules/net'],
    ['templates/vm', '../modules/net', 'templates/modules/net'],
    ['templates/vm', '../../modules/net', 'modules/net'],
    ['', './modules/net', 'modules/net'],
    ['a/b/c', '../../x', 'a/x'],
  ])('resolves %s + %s to %s', (from, rel, expected) => {
    expect(resolveRepoPath(from, rel)).toBe(expected)
  })
})

describe('scanTemplate', () => {
  it('reads every .tf file in the directory, not just variables.tf', async () => {
    repo({
      'templates/vm/main.tf': 'resource "x" "y" {}',
      'templates/vm/variables.tf': 'variable "hostname" { type = string }',
      'templates/vm/extra.tf': 'variable "region" { type = string default = "eu" }',
      'templates/vm/README.md': 'not terraform',
    })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables.map((v) => v.name).sort()).toEqual(['hostname', 'region'])
    expect(scan.filesRead).not.toContain('templates/vm/README.md')
  })

  // The reported case.
  it('finds the variables of a template that only wires modules together', async () => {
    repo({
      'templates/vm/main.tf': `
        module "network" { source = "../../modules/network" }
        module "compute" { source = "../../modules/compute" }
      `,
      'modules/network/variables.tf': 'variable "subnet_cidr" { type = string }',
      'modules/compute/variables.tf': 'variable "instance_type" { type = string }',
    })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables.map((v) => v.name).sort()).toEqual(['instance_type', 'subnet_cidr'])
  })

  it('says which module each variable came from', async () => {
    repo({
      'templates/vm/main.tf': 'module "network" { source = "../../modules/network" }',
      'modules/network/variables.tf': 'variable "subnet_cidr" { type = string }',
    })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables[0].fromModule).toBe('network')
  })

  // Asking the ordering user for a value the template already fixes would have
  // them fill a field the run ignores.
  it('leaves out a child variable the caller already answers', async () => {
    repo({
      'templates/vm/main.tf': `
        module "compute" {
          source        = "../../modules/compute"
          instance_type = "g6-nanode-1"
        }
      `,
      'modules/compute/variables.tf': `
        variable "instance_type" { type = string }
        variable "hostname" { type = string }
      `,
    })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables.map((v) => v.name)).toEqual(['hostname'])
  })

  it('follows modules that call modules', async () => {
    repo({
      'templates/vm/main.tf': 'module "outer" { source = "../../modules/outer" }',
      'modules/outer/main.tf': 'module "inner" { source = "../inner" }',
      'modules/inner/variables.tf': 'variable "deep" { type = string }',
    })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables.map((v) => v.name)).toEqual(['deep'])
    expect(scan.variables[0].fromModule).toBe('outer/inner')
  })

  it('stops following at the depth limit and says so', async () => {
    const files: Record<string, string> = {
      'templates/vm/main.tf': 'module "m0" { source = "../../modules/m0" }',
    }
    for (let i = 0; i < MAX_MODULE_DEPTH + 2; i++) {
      files[`modules/m${i}/main.tf`] = `module "m${i + 1}" { source = "../m${i + 1}" }`
    }
    repo(files)

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.skippedModules.some((s) => s.reason.includes('deeper'))).toBe(true)
  })

  // A partial import that says it is partial is usable; one that does not is a
  // trap. Only reached when the root is silent — a root that declares its own
  // variables has answered the question and the modules are not read at all.
  it('reports a registry module rather than passing over it', async () => {
    repo({ 'templates/vm/main.tf': 'module "vpc" { source = "terraform-aws-modules/vpc/aws" }' })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables).toEqual([])
    expect(scan.skippedModules).toEqual([
      expect.objectContaining({ module: 'vpc', source: 'terraform-aws-modules/vpc/aws' }),
    ])
  })

  it('reports a git:: module the same way', async () => {
    repo({ 'templates/vm/main.tf': 'module "x" { source = "git::https://e.com/x.git" }' })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.skippedModules[0].source).toBe('git::https://e.com/x.git')
  })

  /*
   * The rule that decides everything above, checked against the real
   * `infra-templates` repository. All twelve of its templates are built out of
   * modules AND declare their own variables.tf, under the header "Product
   * parameters (set by users when ordering)". Descending anyway added 17 more
   * variables across those twelve — `tags`, `deletion_protection`, `ami_owner`,
   * `user_data`, `windows_time_zone` — every one a module knob the template
   * author deliberately left at its default, and every one of which would have
   * arrived as a field on the order form.
   */
  it('does not read the modules when the root declares its own variables', async () => {
    repo({
      'templates/vm/variables.tf': `
        variable "volume_label" { type = string }
        variable "region" { type = string }
      `,
      'templates/vm/main.tf': `
        module "volume" {
          source = "../../modules/volume"
          label  = var.volume_label
          region = var.region
        }
      `,
      'modules/volume/variables.tf': `
        variable "label" { type = string }
        variable "region" { type = string }
        variable "tags" { type = list(string) default = [] }
        variable "deletion_protection" { type = bool default = false }
      `,
    })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables.map((v) => v.name)).toEqual(['volume_label', 'region'])
    // Not even read — the internal knobs never reach the operator's list.
    expect(scan.filesRead).not.toContain('modules/volume/variables.tf')
  })

  // Two directories can reach the same module by different routes.
  it('reads a module shared by two callers once', async () => {
    repo({
      'templates/vm/main.tf': `
        module "a" { source = "../../modules/a" }
        module "b" { source = "../../modules/b" }
      `,
      'modules/a/main.tf': 'module "shared" { source = "../shared" }',
      'modules/b/main.tf': 'module "shared" { source = "../shared" }',
      'modules/shared/variables.tf': 'variable "common" { type = string }',
    })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables.map((v) => v.name)).toEqual(['common'])
    expect(scan.filesRead.filter((f) => f.startsWith('modules/shared/'))).toHaveLength(1)
  })

  // Read once, but answered per caller. Skipping the second caller entirely
  // handed it an empty scan, so a variable the FIRST caller happened to assign
  // disappeared for the second one too — and the order form had no field for a
  // value the second module still needs.
  it('still offers a shared variable the other caller answers', async () => {
    repo({
      'templates/vm/main.tf': `
        module "a" {
          source = "../../modules/shared"
          size   = "small"
        }
        module "b" {
          source = "../../modules/shared"
        }
      `,
      'modules/shared/variables.tf': 'variable "size" { type = string }',
    })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables.map((v) => v.name)).toEqual(['size'])
    expect(scan.variables[0].fromModule).toBe('b')
    // Still read once, which is the whole point of the cache.
    expect(scan.filesRead).toEqual(['templates/vm/main.tf', 'modules/shared/variables.tf'])
  })

  // The mirror image: when EVERY caller answers it, it is not asked for.
  it('leaves out a shared variable both callers answer', async () => {
    repo({
      'templates/vm/main.tf': `
        module "a" {
          source = "../../modules/shared"
          size   = "small"
        }
        module "b" {
          source = "../../modules/shared"
          size   = "large"
        }
      `,
      'modules/shared/variables.tf': 'variable "size" { type = string }',
    })

    expect((await scanTemplate(source, '1', 'main', 'templates/vm')).variables).toEqual([])
  })

  // Stored before it is filled, so this terminates instead of recursing forever.
  it('terminates on a module that reaches itself', async () => {
    repo({
      'modules/loop/main.tf': 'module "self" { source = "../loop" }',
      'modules/loop/variables.tf': 'variable "x" { type = string }',
    })

    const scan = await scanTemplate(source, '1', 'main', 'modules/loop')

    expect(scan.variables.map((v) => v.name)).toEqual(['x'])
  })

  // The root declares what the template promises; a module's own declaration of
  // the same name is the implementation detail behind it.
  it('prefers the root declaration over a module of the same name', async () => {
    repo({
      'templates/vm/variables.tf': 'variable "hostname" { type = string description = "the root one" }',
      'templates/vm/main.tf': 'module "compute" { source = "../../modules/compute" }',
      'modules/compute/variables.tf': 'variable "hostname" { type = string description = "the module one" }',
    })

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables).toHaveLength(1)
    expect(scan.variables[0].description).toBe('the root one')
    expect(scan.variables[0].fromModule).toBe('')
  })

  // A directory holding one file the token cannot see is still worth the
  // variables it can.
  it('keeps going when a single file cannot be read', async () => {
    repo({ 'templates/vm/variables.tf': 'variable "ok" { type = string }' })
    listMock.mockImplementation(async () => [
      { name: 'variables.tf', path: 'templates/vm/variables.tf', type: 'blob' },
      { name: 'secret.tf', path: 'templates/vm/secret.tf', type: 'blob' },
    ])

    const scan = await scanTemplate(source, '1', 'main', 'templates/vm')

    expect(scan.variables.map((v) => v.name)).toEqual(['ok'])
    expect(scan.skippedModules.some((s) => s.source.endsWith('secret.tf'))).toBe(true)
  })

  it('honours the ref it is given rather than always reading main', async () => {
    repo({ 'templates/vm/variables.tf': 'variable "x" { type = string }' })

    await scanTemplate(source, '42', 'release/2026-08', 'templates/vm')

    expect(listMock).toHaveBeenCalledWith(source, '42', 'release/2026-08', 'templates/vm')
    expect(contentMock).toHaveBeenCalledWith(source, '42', 'release/2026-08', 'templates/vm/variables.tf')
  })
})
