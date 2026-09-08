import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { isValidSessionId, resolveDataDir, sessionPath } from '../../src/store/paths.js'

const HOME = '/home/tester'

describe('resolveDataDir', () => {
  it('defaults to ~/.dealbuddy when nothing is configured', () => {
    expect(resolveDataDir('', {}, HOME)).toBe(join(HOME, '.dealbuddy'))
  })

  it('honours DEALBUDDY_HOME when the config is empty', () => {
    expect(resolveDataDir('', { DEALBUDDY_HOME: '/tmp/db' }, HOME)).toBe('/tmp/db')
  })

  it('lets the config field win over the environment', () => {
    expect(resolveDataDir('/opt/db', { DEALBUDDY_HOME: '/tmp/db' }, HOME)).toBe('/opt/db')
  })

  it('expands a leading tilde', () => {
    expect(resolveDataDir('~/shopping', {}, HOME)).toBe(join(HOME, 'shopping'))
    expect(resolveDataDir('~', {}, HOME)).toBe(HOME)
  })

  it('anchors a relative value to the home directory, not the process cwd', () => {
    expect(resolveDataDir('shopping', {}, HOME)).toBe(join(HOME, 'shopping'))
  })
})

describe('isValidSessionId', () => {
  it('accepts the ids the Python store generates', () => {
    expect(isValidSessionId('4a71eebe7fac')).toBe(true)
  })

  it('accepts hyphens and non-ASCII letters, mirroring str.isalnum', () => {
    expect(isValidSessionId('abc-123')).toBe(true)
    expect(isValidSessionId('会话1')).toBe(true)
  })

  it('rejects ids that would escape the sessions directory', () => {
    for (const bad of ['..', '../x', 'a/b', 'a_b', '', '-', '---', 'a.json']) {
      expect(isValidSessionId(bad), bad).toBe(false)
    }
  })
})

describe('sessionPath', () => {
  it('places sessions under <dataDir>/sessions', () => {
    expect(sessionPath('/data', 'abc123')).toBe(join('/data', 'sessions', 'abc123.json'))
  })

  it('throws on an invalid id', () => {
    expect(() => sessionPath('/data', '../escape')).toThrow('Invalid session id')
  })
})
