import { randomBytes } from 'crypto'
import { spawnSync } from 'child_process'
import { join } from 'path'
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

const container = `forgevid-auth-e2e-${randomBytes(5).toString('hex')}`
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker'
const prismaCli = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js')
const playwrightCli = join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js')

function run(command: string, args: string[], env = process.env, capture = false) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${capture ? result.stderr : ''}`)
  }
  return String(result.stdout ?? '').trim()
}

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

try {
  run(docker, [
    'run', '-d', '--rm', '--name', container,
    '-e', 'POSTGRES_USER=postgres',
    '-e', 'POSTGRES_PASSWORD=forgevid_auth_e2e',
    '-e', 'POSTGRES_DB=forgevid_auth_e2e',
    '-p', '127.0.0.1::5432',
    'postgres:16-alpine',
  ])
  const mapping = run(docker, ['port', container, '5432/tcp'], process.env, true)
  const port = mapping.match(/:(\d+)\s*$/)?.[1]
  if (!port) throw new Error(`Could not resolve scratch PostgreSQL port: ${mapping}`)

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = spawnSync(docker, ['exec', container, 'pg_isready', '-U', 'postgres'], {
      stdio: 'ignore',
    })
    if (ready.status === 0) break
    if (attempt === 59) throw new Error('Scratch PostgreSQL did not become ready')
    sleep(1_000)
  }

  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:forgevid_auth_e2e@127.0.0.1:${port}/forgevid_auth_e2e`,
    NEXTAUTH_URL: 'http://localhost:3000',
    NEXTAUTH_SECRET: 'forgevid-isolated-browser-audit-secret',
    BETA_MODE: 'false',
    NEXT_PUBLIC_BETA_MODE: 'false',
    PLAYWRIGHT_NEXT_SERVER: 'true',
    AUTH_E2E: 'true',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    REDIS_URL: '',
  }
  run(process.execPath, [prismaCli, 'migrate', 'deploy'], env)
  run(process.execPath, [
    playwrightCli,
    'test',
    'tests/e2e/authenticated-platform.spec.ts',
    '--project=chromium',
    '--workers=1',
    ...process.argv.slice(2),
  ], env)
} finally {
  spawnSync(docker, ['rm', '-f', container], { stdio: 'ignore' })
}
