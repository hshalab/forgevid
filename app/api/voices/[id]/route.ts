import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { revokeClonedVoice } from '@/lib/cloned-voices';
import { recordLearningConsent } from '@/lib/learning-consent';

export async function DELETE(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const { id } = await props.params;
  try {
    await revokeClonedVoice(session.user.id, id);
    // Revocation lands in the consent ledger too — same audit trail the
    // clone wrote to. Best-effort; the voice is already gone upstream.
    void recordLearningConsent({
      userId: session.user.id,
      purpose: 'voice_clone',
      granted: false,
      source: 'voice_revocation',
      policyVersion: 'voice-consent-v1',
      evidence: { voiceId: id },
    }).catch((error) => console.warn('[voices/delete] consent ledger append failed:', error));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voice deletion failed';
    return NextResponse.json({ error: message }, { status: message === 'Voice not found' ? 404 : 502 });
  }
}
