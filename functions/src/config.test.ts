import { describe, expect, it } from 'vitest'
import { findConfigProblem } from './config'

const CLIENT_ID = '123-abc.apps.googleusercontent.com'
const SECRET = 'GOCSPX-abcdefghijklmnopqrstuvwxyz1'

describe('findConfigProblem', () => {
  it('godtar ett Client ID och en Client secret som ser rätt ut', () => {
    expect(findConfigProblem({ clientId: CLIENT_ID, clientSecret: SECRET })).toBeNull()
  })

  it('godtar äldre Client secrets utan GOCSPX-prefix', () => {
    expect(
      findConfigProblem({ clientId: CLIENT_ID, clientSecret: 'abcdEFGH1234abcdEFGH1234' }),
    ).toBeNull()
  })

  it('upptäcker att Client ID inte är ett Client ID (t.ex. ett inklistrat kommando)', () => {
    expect(
      findConfigProblem({
        clientId: 'npx firebase-tools functions:secrets:set GOOGLE_CLIENT_ID',
        clientSecret: SECRET,
      }),
    ).toBe('client_id_has_whitespace')
    expect(findConfigProblem({ clientId: 'abc', clientSecret: SECRET })).toBe(
      'client_id_missing_suffix',
    )
  })

  it('upptäcker att Client ID har hamnat som Client secret', () => {
    expect(findConfigProblem({ clientId: CLIENT_ID, clientSecret: CLIENT_ID })).toBe(
      'client_secret_looks_like_client_id',
    )
  })

  it('upptäcker blanksteg och radbrytningar i värdena', () => {
    expect(findConfigProblem({ clientId: `${CLIENT_ID}\n`, clientSecret: SECRET })).toBe(
      'client_id_has_whitespace',
    )
    expect(findConfigProblem({ clientId: CLIENT_ID, clientSecret: `${SECRET}\n` })).toBe(
      'client_secret_has_whitespace',
    )
  })

  it('returnerar bara en kategori och aldrig själva värdena', () => {
    const problem = findConfigProblem({ clientId: CLIENT_ID, clientSecret: CLIENT_ID })
    expect(problem).not.toContain(CLIENT_ID)
  })
})
