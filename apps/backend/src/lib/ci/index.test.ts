import { describe, it, expect, vi } from 'vitest'
import { parseTofuOutputs, fetchJobTraces, type CiSourceInfo } from './index'


describe('parseTofuOutputs', () => {
  it('parses simple string outputs', () => {
    const trace = [
      'Apply complete! Resources: 3 added.',
      '',
      'Outputs:',
      '',
      'cluster_endpoint = "https://k8s.example.com"',
      'cluster_name = "my-cluster"',
    ].join('\n')
    expect(parseTofuOutputs(trace)).toEqual({
      cluster_endpoint: 'https://k8s.example.com',
      cluster_name: 'my-cluster',
    })
  })

  it('strips ANSI escape codes before parsing', () => {
    const trace = '\x1b[32mOutputs:\x1b[0m\n\nkey = "value"\n'
    expect(parseTofuOutputs(trace)).toEqual({ key: 'value' })
  })

  it('returns empty object when there is no Outputs section', () => {
    expect(parseTofuOutputs('Apply complete! No outputs.')).toEqual({})
  })

  it('stops collecting at the next non-assignment line', () => {
    const trace = ['Outputs:', '', 'foo = "bar"', '', 'Warning: something else'].join('\n')
    expect(parseTofuOutputs(trace)).toEqual({ foo: 'bar' })
  })

  it('stops at a summary line that follows the block', () => {
    const trace = ['Outputs:', '', 'foo = "bar"', 'Apply complete! Resources: 1 added.'].join('\n')
    expect(parseTofuOutputs(trace)).toEqual({ foo: 'bar' })
  })

  it('keeps unquoted scalars — numbers and booleans are outputs too', () => {
    // These used to be dropped without trace, so a template that declared a port
    // looked like one that had forgotten to.
    const trace = ['Outputs:', '', 'foo = "valid"', 'bar = 42', 'baz = true'].join('\n')
    expect(parseTofuOutputs(trace)).toEqual({ foo: 'valid', bar: '42', baz: 'true' })
  })

  it('records a sensitive output as such rather than omitting it', () => {
    // "There is a value here and it is not shown" is information; a missing key
    // reads as a template that never declared the output.
    const trace = ['Outputs:', '', 'db_password = <sensitive>', 'host = "db.internal"'].join('\n')
    expect(parseTofuOutputs(trace)).toEqual({ db_password: '<sensitive>', host: 'db.internal' })
  })

  it('collects a multi-line list into one value', () => {
    const trace = [
      'Outputs:',
      '',
      'addresses = [',
      '  "10.0.0.4",',
      '  "10.0.0.5",',
      ']',
      'name = "cluster"',
    ].join('\n')
    expect(parseTofuOutputs(trace)).toEqual({
      addresses: '[ "10.0.0.4", "10.0.0.5", ]',
      name: 'cluster',
    })
  })

  it('collects a multi-line map, including nested brackets', () => {
    const trace = [
      'Outputs:',
      '',
      'config = {',
      '  "limits" = {',
      '    "cpu" = "2"',
      '  }',
      '}',
      'ready = true',
    ].join('\n')
    const parsed = parseTofuOutputs(trace)
    expect(parsed.config).toContain('"cpu" = "2"')
    expect(parsed.ready).toBe('true')
  })

  it('keeps a heredoc value whole, and does not lose the outputs after it', () => {
    // The heredoc body is arbitrary text: it contains an '=' , a bracket and a
    // blank line, none of which may be read as parser syntax.
    const trace = [
      'Outputs:',
      '',
      'kubeconfig = <<EOT',
      'apiVersion: v1',
      'clusters:',
      '  - cluster: { server: https://k8s.example.com }',
      '',
      'users: []',
      'EOT',
      'name = "cluster"',
    ].join('\n')
    const parsed = parseTofuOutputs(trace)
    expect(parsed.kubeconfig).toContain('apiVersion: v1')
    expect(parsed.kubeconfig).toContain('users: []')
    // Line structure survives — a kubeconfig on one line is not a kubeconfig.
    expect(parsed.kubeconfig.split('\n').length).toBeGreaterThan(3)
    expect(parsed.name).toBe('cluster')
  })

  it('accepts the indented heredoc form too', () => {
    const trace = ['Outputs:', '', 'note = <<-EOF', '  hello', 'EOF', 'ok = true'].join('\n')
    expect(parseTofuOutputs(trace)).toEqual({ note: 'hello', ok: 'true' })
  })

  it('does not mistake a bracket inside a quoted string for a structured value', () => {
    // 'prefix = "a [ b"' is a finished scalar. Counting that bracket would swallow
    // every following output into it.
    const trace = [
      'Outputs:',
      '',
      'prefix = "vm-[01]"',
      'expr = "${count.index} { }"',
      'name = "cluster"',
    ].join('\n')
    expect(parseTofuOutputs(trace)).toEqual({
      prefix: 'vm-[01]',
      expr: '${count.index} { }',
      name: 'cluster',
    })
  })

  it('closes a list whose elements contain brackets in strings', () => {
    const trace = ['Outputs:', '', 'names = [', '  "a[0]",', '  "b{1}",', ']', 'ok = true'].join('\n')
    const parsed = parseTofuOutputs(trace)
    expect(parsed.names).toBe('[ "a[0]", "b{1}", ]')
    expect(parsed.ok).toBe('true')
  })

  it('does not treat a blank line as the end of the block', () => {
    // Terraform prints one after the header, and the old parser only survived that
    // by accident.
    const trace = ['Outputs:', '', 'first = "a"', '', 'second = "b"'].join('\n')
    expect(parseTofuOutputs(trace)).toEqual({ first: 'a', second: 'b' })
  })

  it('handles multiple ANSI sequences in a single line', () => {
    const trace = '\x1b[1m\x1b[32mOutputs:\x1b[0m\n\n\x1b[33mresult\x1b[0m = "ok"\n'
    expect(parseTofuOutputs(trace)).toEqual({ result: 'ok' })
  })

  it('handles empty trace gracefully', () => {
    expect(parseTofuOutputs('')).toEqual({})
  })
})

describe('fetchJobTraces dispatch', () => {
  it('returns no traces for github, rather than an empty log that reads as "no outputs"', async () => {
    const source: CiSourceInfo = { url: '', accessToken: '', provider: 'github' }
    expect(await fetchJobTraces(source, '1')).toEqual([])
  })

  it('returns no traces for bitbucket', async () => {
    const source: CiSourceInfo = { url: '', accessToken: '', provider: 'bitbucket' }
    expect(await fetchJobTraces(source, '1')).toEqual([])
  })

  it('rejects for gitlab without a projectRef instead of requesting an unscoped URL', async () => {
    // Issue #121: the job endpoints are project-scoped, so a source that cannot say
    // which project it triggers has to fail loudly — the caller reports which
    // environment is misconfigured.
    const fetchMock = vi.spyOn(global, 'fetch')
    const source: CiSourceInfo = {
      url: 'https://gitlab.example.com',
      accessToken: 'tok',
      provider: 'gitlab',
    }

    await expect(fetchJobTraces(source, '42')).rejects.toThrow(/project-scoped/)
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })
})
