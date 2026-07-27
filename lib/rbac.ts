import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { UserRole as PrismaUserRole } from '@prisma/client';

/**
 * Role-Based Access Control (RBAC) middleware for API routes.
 *
 * Usage:
 *   export const GET = withAdmin(async (req) => { ... });
 *   export const POST = withRBAC(['MANAGER', 'ADMIN'])(async (req) => { ... });
 */

type UserRole = PrismaUserRole;

interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  organizationId?: string | null;
}

export interface AuthenticatedRequest extends NextRequest {
  user: SessionUser;
}

export const AUTHENTICATED_ROLES: UserRole[] = ['USER', 'VIEWER', 'MANAGER', 'ADMIN'];
export const ADMIN_ROLES: UserRole[] = ['ADMIN'];

export function isAdminRole(role: UserRole): boolean {
  return ADMIN_ROLES.includes(role);
}

/**
 * The fresh-session admin check for route handlers that read the acting
 * admin's identity (unlike the withAdmin wrapper, which hides it). Returns
 * the session user when they are an admin, null otherwise — the caller
 * turns null into its 403. Extracted once this reached three copy-pasted
 * occurrences (admin/leads, admin/beta-access, admin/payments).
 */
export async function requireAdmin(): Promise<SessionUser | null> {
  const user = await getFreshSessionUser();
  if (!user || !isAdminRole(user.role)) return null;
  return user;
}

export async function getFreshSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return null;
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      role: true,
      organizationId: true,
    },
  });

  if (!currentUser) {
    return null;
  }

  return {
    id: currentUser.id,
    email: currentUser.email,
    role: currentUser.role,
    organizationId: currentUser.organizationId,
  };
}

/**
 * Higher-order function that wraps an API handler with role-based authorization.
 * @param allowedRoles - Array of roles permitted to access the endpoint
 * @param options - Optional config: requireOrg enforces organization membership
 */
export function withRBAC(
  allowedRoles: UserRole[],
  options?: { requireOrg?: boolean }
) {
  return function rbacWrapper(
    handler: (req: NextRequest, context?: any) => Promise<NextResponse>
  ) {
    return async function rbacHandler(req: NextRequest, context?: any): Promise<NextResponse> {
      // 1. Load the current user from the database so role changes take effect immediately.
      const user = await getFreshSessionUser();

      if (!user) {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }

      // 2. Check role
      if (!allowedRoles.includes(user.role)) {
        return NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 }
        );
      }

      // 3. Optionally require organization membership
      if (options?.requireOrg && !user.organizationId) {
        return NextResponse.json(
          { error: 'Organization membership required' },
          { status: 403 }
        );
      }

      // 4. Attach user to request for downstream handlers
      (req as any).user = user;

      return handler(req, context);
    };
  };
}

/**
 * Simple authentication guard (any authenticated user).
 */
export function withAuth(
  handler: (req: NextRequest, context?: any) => Promise<NextResponse>
) {
  return withRBAC(AUTHENTICATED_ROLES)(handler);
}

/**
 * Admin-only guard.
 */
export function withAdmin(
  handler: (req: NextRequest, context?: any) => Promise<NextResponse>
) {
  return withRBAC(ADMIN_ROLES)(handler);
}

/**
 * Highest-privilege admin guard.
 * This repository's current role model tops out at ADMIN.
 */
export function withSuperAdmin(
  handler: (req: NextRequest, context?: any) => Promise<NextResponse>
) {
  return withRBAC(ADMIN_ROLES)(handler);
}
