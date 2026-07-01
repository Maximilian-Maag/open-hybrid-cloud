import { describe, it, expect } from 'vitest'
import { parseTerraformVariables } from './index'

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
})
