import { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import OktaProvider from 'next-auth/providers/okta'
import AzureADProvider from 'next-auth/providers/azure-ad'
import bcrypt from 'bcryptjs'
import type { SSOConfiguration, SSOProvider as SSOProviderEnum, UserRole } from '@prisma/client'
import { prisma } from './prisma'
import { verifyMfaToken } from './mfa'
import { getActiveSsoConfigurations, getGlobalSsoConfiguration } from './sso'
import { isBetaAccessAllowed } from './beta-access'
import { getOrCreateReferralCode } from './referral'

type AnyProvider = ReturnType<typeof CredentialsProvider>

function createEmailPasswordProvider(): AnyProvider {
  return CredentialsProvider({
    id: 'credentials',
    name: 'credentials',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
      mfaCode: { label: 'MFA Code', type: 'text' },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) {
        return null
      }

      const user = await prisma.user.findUnique({
        where: { email: credentials.email },
      })

      if (!user || !user.password) {
        return null
      }

      const isPasswordValid = await bcrypt.compare(credentials.password, user.password)

      if (!isPasswordValid) {
        return null
      }

      if (user.mfaEnabled) {
        const providedCode = credentials.mfaCode?.toString().trim()

        if (!providedCode) {
          const error = new Error('MFA_REQUIRED')
          error.name = 'MFA_REQUIRED'
          throw error
        }

        const isValid = user.mfaSecret ? verifyMfaToken(user.mfaSecret, providedCode) : false

        if (!isValid) {
          throw new Error('INVALID_MFA_CODE')
        }
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        organizationId: user.organizationId,
      }
    },
  })
}

function createBaseProviders(): AnyProvider[] {
  const providers: AnyProvider[] = []

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }) as unknown as AnyProvider
    )
  }

  providers.push(createEmailPasswordProvider())
  return providers
}

async function buildSsoProviders(): Promise<AnyProvider[]> {
  const configs = await getActiveSsoConfigurations()
  const globalConfigs = configs.filter((config) => !config.organizationId)

  if (!globalConfigs.length) {
    return []
  }

  const providers: AnyProvider[] = []

  const oktaConfig = globalConfigs.find((config) => config.provider === 'OKTA')
  if (oktaConfig && oktaConfig.issuer && oktaConfig.clientId && oktaConfig.clientSecret) {
    providers.push(
      OktaProvider({
        issuer: oktaConfig.issuer,
        clientId: oktaConfig.clientId,
        clientSecret: oktaConfig.clientSecret,
        authorization: {
          params: {
            scope: 'openid profile email',
          },
        },
        profile(profile): any {
          return {
            id: profile.sub || profile.id,
            email: profile.email || profile.preferred_username,
            name: profile.name || profile.email || profile.preferred_username,
          }
        },
      }) as unknown as AnyProvider
    )
  }

  const azureConfig = globalConfigs.find((config) => config.provider === 'AZURE')
  if (azureConfig && azureConfig.clientId && azureConfig.clientSecret) {
    providers.push(
      AzureADProvider({
        clientId: azureConfig.clientId,
        clientSecret: azureConfig.clientSecret,
        tenantId: azureConfig.tenantId || 'common',
        profile(profile): any {
          return {
            id: profile.sub || profile.oid || profile.id,
            email: profile.email || profile.preferred_username,
            name:
              profile.name ||
              [profile.given_name, profile.family_name].filter(Boolean).join(' ') ||
              profile.preferred_username,
          }
        },
      }) as unknown as AnyProvider
    )
  }

  const samlConfig = globalConfigs.find((config) => config.provider === 'SAML')
  if (samlConfig) {
    providers.push(createSamlCredentialsProvider(samlConfig))
  }

  return providers
}

function createSamlCredentialsProvider(config: SSOConfiguration): AnyProvider {
  if (!config.enabled) {
    throw new Error('SAML configuration is disabled')
  }

  const provider = CredentialsProvider({
    id: 'saml',
    name: 'SAML 2.0',
    credentials: {
      SAMLResponse: { label: 'SAMLResponse', type: 'text' },
      RelayState: { label: 'RelayState', type: 'text' },
    },
    async authorize(credentials) {
      if (!credentials?.SAMLResponse) {
        return null
      }

      const { validateSamlAssertion } = await import('./sso/saml')
      const assertion = await validateSamlAssertion(credentials.SAMLResponse, config)

      if (!assertion?.email) {
        throw new Error('INVALID_SAML_ASSERTION')
      }

      const provisionedUser = await findOrCreateSsoUser(assertion.email, 'SAML', assertion.profile ?? assertion)
      if (!provisionedUser) {
        throw new Error('SSO_PROVISIONING_ERROR')
      }

      return {
        id: provisionedUser.id,
        email: provisionedUser.email,
        name: assertion.name || provisionedUser.name || provisionedUser.email,
        role: provisionedUser.role,
        organizationId: provisionedUser.organizationId,
      }
    },
  })

  return {
    ...provider,
    id: 'saml',
    name: 'SAML 2.0',
  } as AnyProvider
}

async function composeProviders(): Promise<AnyProvider[]> {
  const base = createBaseProviders()
  const sso = await buildSsoProviders()
  return [...base, ...sso]
}

let composedProviders: AnyProvider[] = createBaseProviders()
let providerInitializationPromise: Promise<AnyProvider[]> | null = null

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: composedProviders,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || !user?.email) {
        return true
      }

      const existingUser = await prisma.user.findUnique({ where: { email: user.email } })
      if (!existingUser && account.provider !== 'credentials') {
        const betaAccess = await isBetaAccessAllowed({ email: user.email })
        if (!betaAccess.allowed) {
          return '/auth/signup?error=invite-required'
        }
      }

      const providerEnum = mapProviderIdToEnum(account.provider)

      if (!providerEnum) {
        return true
      }

      const provisionedUser = await findOrCreateSsoUser(user.email, providerEnum, profile ?? {})
      if (!provisionedUser) {
        return false
      }

      user.id = provisionedUser.id
      user.role = provisionedUser.role
      ;(user as any).organizationId = provisionedUser.organizationId
      getOrCreateReferralCode(provisionedUser.id).catch((error) =>
        console.error('[Referral] Failed to provision SSO referral code:', error),
      )
      return true
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = (user as any).role ?? token.role
        token.id = user.id
        token.organizationId = (user as any).organizationId ?? token.organizationId
      }
      // Reflect an in-app profile rename (client calls session.update({ name }))
      // into the JWT, so every useSession() consumer — e.g. the dashboard
      // sidebar — shows the new name without forcing a re-login.
      if (trigger === 'update' && typeof (session as any)?.name === 'string') {
        token.name = (session as any).name
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        if (token.organizationId) {
          ;(session.user as any).organizationId = token.organizationId as string
        }
        // JWTs are stateless — without this, a DELETED (or SUSPENDED)
        // account keeps a working session for the token's full 30-day life.
        // One indexed primary-key lookup per session resolution is the cost
        // of deletion actually meaning deletion.
        if (token.id) {
          const current = await prisma.user
            .findUnique({ where: { id: token.id as string }, select: { status: true } })
            .catch(() => null)
          if (!current || current.status === 'DELETED' || current.status === 'SUSPENDED') {
            ;(session as any).user = undefined
            return session
          }
        }
      }
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
  secret: process.env.NEXTAUTH_SECRET,
}

function scheduleProviderInitialization() {
  providerInitializationPromise = composeProviders()
    .then((providers) => {
      composedProviders = providers
      authOptions.providers = providers
      return providers
    })
    .catch((error) => {
      console.error('[Auth] Failed to compose SSO providers:', error)
      return composedProviders
    })

  return providerInitializationPromise
}

export async function ensureAuthProvidersReady() {
  if (!providerInitializationPromise) {
    scheduleProviderInitialization()
  }
  await providerInitializationPromise
}

scheduleProviderInitialization()

export async function refreshAuthProviders() {
  composedProviders = await composeProviders()
  authOptions.providers = composedProviders
  providerInitializationPromise = Promise.resolve(composedProviders)
}

export function mapProviderIdToEnum(providerId: string | undefined): SSOProviderEnum | null {
  switch (providerId) {
    case 'okta':
      return 'OKTA'
    case 'azure-ad':
    case 'azuread':
      return 'AZURE'
    case 'saml':
      return 'SAML'
    default:
      return null
  }
}

export async function findOrCreateSsoUser(email: string, provider: SSOProviderEnum, profile: Record<string, any>) {
  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    return existingUser
  }

  const ssoConfig = await getGlobalSsoConfiguration(provider)
  if (!ssoConfig) {
    return null
  }

  const defaultRole: UserRole = ssoConfig.defaultRole ?? 'USER'

  return prisma.user.create({
    data: {
      email,
      name:
        profile.name ||
        profile.displayName ||
        [profile.given_name, profile.family_name].filter(Boolean).join(' ') ||
        profile.preferred_username ||
        undefined,
      image: profile.picture || profile.avatar || undefined,
      role: defaultRole,
      organizationId: ssoConfig.organizationId,
      password: null,
      metadata: JSON.stringify({ provider, profile }),
      emailVerified: new Date(),
    },
  })
}

export const __internal = {
  createSamlCredentialsProvider,
  composeProviders,
}
