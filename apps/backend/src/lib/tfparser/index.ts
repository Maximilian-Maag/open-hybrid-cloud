import type { Parameter } from '@/lib/db/schema'

type ParsedParameter = Omit<Parameter, 'id' | 'scope' | 'scopeId' | 'environmentId'>

// Match variable blocks including nested braces
const extractVariableBlocks = (content: string): Array<{ name: string; body: string }> => {
  const results: Array<{ name: string; body: string }> = []
  const pattern = /variable\s+"([^"]+)"\s*\{/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    const name = match[1]
    const start = match.index + match[0].length
    let depth = 1
    let i = start

    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++
      else if (content[i] === '}') depth--
      i++
    }

    const body = content.slice(start, i - 1)
    results.push({ name, body })
  }

  return results
}

const extractStringValue = (body: string, key: string): string | undefined => {
  const match = body.match(new RegExp(`${key}\\s*=\\s*"([^"]*)"`, 'm'))
  return match?.[1]
}

const extractBareValue = (body: string, key: string): string | undefined => {
  const match = body.match(new RegExp(`${key}\\s*=\\s*([^\\n\\r]+)`, 'm'))
  return match?.[1]?.trim()
}

const mapType = (
  rawType: string | undefined,
  body: string,
): 'string' | 'number' | 'bool' | 'dropdown' => {
  // Use dropdown if validation block with condition exists
  if (/validation\s*\{[^}]*condition\s*=/s.test(body)) return 'dropdown'

  const t = (rawType ?? 'string').trim().toLowerCase()
  if (t === 'number') return 'number'
  if (t === 'bool') return 'bool'
  if (t === 'string') return 'string'
  return 'string'
}

const extractSensitive = (body: string): boolean => {
  const match = body.match(/sensitive\s*=\s*(true|false)/m)
  return match?.[1] === 'true'
}

const extractRequired = (body: string): boolean => {
  // A variable without a default is required
  return !/default\s*=/.test(body)
}

const extractDefault = (body: string): string => {
  const stringDefault = extractStringValue(body, 'default')
  if (stringDefault !== undefined) return stringDefault

  const bareDefault = extractBareValue(body, 'default')
  if (!bareDefault || bareDefault === 'null') return ''

  return bareDefault
}

export const parseTerraformVariables = (content: string): ParsedParameter[] => {
  const blocks = extractVariableBlocks(content)
  return blocks.map(({ name, body }) => {
    const rawType = extractStringValue(body, 'type') ?? extractBareValue(body, 'type')
    return {
      name,
      label: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      type: mapType(rawType, body),
      description: extractStringValue(body, 'description') ?? '',
      defaultValue: extractDefault(body),
      required: extractRequired(body),
      sensitive: extractSensitive(body),
    }
  })
}
