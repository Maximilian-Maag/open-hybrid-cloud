import { describe, it, expect } from 'vitest'
import { parseTerraformVariables, parseTerraformModules } from './index'

describe('parseTerraformVariables', () => {
  it('parses a simple string variable', () => {
    const hcl = `
variable "cluster_name" {
  type        = string
  description = "Name of the cluster"
  default     = "my-cluster"
}
`
    expect(parseTerraformVariables(hcl)).toEqual([
      {
        name: 'cluster_name',
        label: 'Cluster Name',
        type: 'string',
        description: 'Name of the cluster',
        defaultValue: 'my-cluster',
        required: false,
        sensitive: false,
      },
    ])
  })

  it('parses a number variable', () => {
    const hcl = `
variable "node_count" {
  type    = number
  default = 3
}
`
    const vars = parseTerraformVariables(hcl)
    expect(vars[0].type).toBe('number')
    expect(vars[0].defaultValue).toBe('3')
    expect(vars[0].required).toBe(false)
  })

  it('parses a bool variable', () => {
    const hcl = `
variable "enable_ha" {
  type    = bool
  default = false
}
`
    expect(parseTerraformVariables(hcl)[0].type).toBe('bool')
  })

  it('marks variable as required when no default is set', () => {
    const hcl = `
variable "api_key" {
  type        = string
  description = "API key"
}
`
    expect(parseTerraformVariables(hcl)[0].required).toBe(true)
    expect(parseTerraformVariables(hcl)[0].defaultValue).toBe('')
  })

  it('marks variable as sensitive', () => {
    const hcl = `
variable "secret_token" {
  type      = string
  sensitive = true
}
`
    const vars = parseTerraformVariables(hcl)
    expect(vars[0].sensitive).toBe(true)
    expect(vars[0].required).toBe(true)
  })

  it('detects dropdown type from validation block', () => {
    const hcl = `
variable "region" {
  type    = string
  default = "eu-west-1"
  validation {
    condition     = contains(["eu-west-1", "us-east-1"], var.region)
    error_message = "Invalid region."
  }
}
`
    expect(parseTerraformVariables(hcl)[0].type).toBe('dropdown')
  })

  it('parses multiple variables', () => {
    const hcl = `
variable "a" {
  type    = string
  default = "alpha"
}
variable "b" {
  type    = number
  default = 10
}
`
    const vars = parseTerraformVariables(hcl)
    expect(vars).toHaveLength(2)
    expect(vars[0].name).toBe('a')
    expect(vars[1].name).toBe('b')
  })

  it('returns empty array for content with no variable blocks', () => {
    expect(parseTerraformVariables('# just a comment\n')).toEqual([])
  })

  it('handles null default gracefully', () => {
    const hcl = `
variable "optional" {
  type    = string
  default = null
}
`
    const vars = parseTerraformVariables(hcl)
    expect(vars[0].defaultValue).toBe('')
    expect(vars[0].required).toBe(false)
  })

  it('auto-generates label from variable name', () => {
    const hcl = `
variable "instance_type" {
  type = string
}
`
    const vars = parseTerraformVariables(hcl)
    expect(vars[0].label).toBe('Instance Type')
  })

  // The same unanchored match that lost a module's source takes a variable's
  // description and default from any argument whose name happens to end in one.
  it('does not take the description from an argument ending in description', () => {
    const vars = parseTerraformVariables(`
variable "size" {
  type            = string
  long_description = "the wrong one"
  description      = "the right one"
}
`)
    expect(vars[0].description).toBe('the right one')
  })

  it('does not take the default from an argument ending in default', () => {
    const vars = parseTerraformVariables(`
variable "size" {
  type        = string
  has_default = "yes"
  default     = "small"
}
`)
    expect(vars[0].defaultValue).toBe('small')
  })
})

describe('parseTerraformModules', () => {
  it('reads the label and the source', () => {
    const modules = parseTerraformModules(`
      module "network" {
        source = "../modules/network"
      }
    `)
    expect(modules).toEqual([{ name: 'network', source: '../modules/network', assigned: [] }])
  })

  it('reads every module in the file', () => {
    const modules = parseTerraformModules(`
      module "network" { source = "./modules/network" }
      module "compute" { source = "./modules/compute" }
    `)
    expect(modules.map((m) => m.name)).toEqual(['network', 'compute'])
  })

  // The assigned names are what the caller has already answered, so they are the
  // child variables the ordering user does NOT have to supply.
  it('reads the arguments the caller assigns', () => {
    const [call] = parseTerraformModules(`
      module "compute" {
        source        = "../modules/compute"
        instance_type = var.instance_type
        region        = "eu-central"
        count         = 3
      }
    `)
    // `source` and `count` are meta-arguments — how the module is called, not
    // inputs it declares.
    expect(call.assigned.sort()).toEqual(['instance_type', 'region'])
  })

  // A key inside a nested block is not an input the child declares as a
  // variable, and counting it would wrongly mark a real variable as answered.
  it('ignores keys nested inside a block argument', () => {
    const [call] = parseTerraformModules(`
      module "compute" {
        source = "../modules/compute"
        providers = {
          aws = aws.eu
          region = "nested-not-an-input"
        }
        tags = {
          owner = "platform"
        }
        hostname = var.hostname
      }
    `)
    expect(call.assigned).toContain('tags')
    expect(call.assigned).toContain('hostname')
    expect(call.assigned).not.toContain('source')
    expect(call.assigned).not.toContain('providers')
    // `region` and `owner` live inside the nested maps.
    expect(call.assigned).not.toContain('region')
    expect(call.assigned).not.toContain('owner')
  })

  it('survives braces inside a nested block', () => {
    const modules = parseTerraformModules(`
      module "a" {
        source = "./a"
        settings = {
          inner = {
            deep = true
          }
        }
      }
      module "b" { source = "./b" }
    `)
    expect(modules.map((m) => m.name)).toEqual(['a', 'b'])
    expect(modules[1].source).toBe('./b')
  })

  it('skips a module block with no source', () => {
    expect(parseTerraformModules(`module "broken" { version = "1.0" }`)).toEqual([])
  })

  it('finds nothing in a file with no modules', () => {
    expect(parseTerraformModules(`variable "x" { type = string }`)).toEqual([])
  })

  // `String.match` returns the first hit anywhere in the body, so an unanchored
  // `source` matched inside `image_source` and the module's real source was
  // never reached. `isLocalSource` then said no and every child variable behind
  // it was lost.
  it('does not read an argument ending in source as the module source', () => {
    const modules = parseTerraformModules(`
      module "vm" {
        image_source = "ubuntu-24"
        source       = "../modules/vm"
      }
    `)
    expect(modules[0].source).toBe('../modules/vm')
  })

  it('does not read a dotted reference as the key either', () => {
    const modules = parseTerraformModules(`
      module "vm" {
        upstream = local.source
        source   = "../modules/vm"
      }
    `)
    expect(modules[0].source).toBe('../modules/vm')
  })

  // A registry or git source cannot be read through the CI file API; the caller
  // has to tell them apart, so the raw string is kept rather than normalised.
  it('keeps a remote source verbatim', () => {
    const modules = parseTerraformModules(`
      module "vpc" { source = "terraform-aws-modules/vpc/aws" }
      module "x"   { source = "git::https://example.com/x.git//sub?ref=v1" }
    `)
    expect(modules.map((m) => m.source)).toEqual([
      'terraform-aws-modules/vpc/aws',
      'git::https://example.com/x.git//sub?ref=v1',
    ])
  })
})
