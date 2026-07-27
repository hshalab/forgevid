import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { securityConfigs } from '@/lib/api-security';
import { exportTimelineVideo, type ExportTrack } from '@/lib/video-export';
import { resolveBranding } from '@/lib/brand-kit';
import { uploadVideo } from '@/lib/cloudinary';
import { sendExportCompleteEmail } from '@/lib/email';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

/**
 * Editor Export API - Export edited video from timeline
 * POST: Export video from editor state
 */

async function handlePost(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { videoId, settings } = body;

    if (!videoId) {
      return NextResponse.json({ error: 'Video ID required' }, { status: 400 });
    }

    // Verify ownership
    const video = await prisma.video.findUnique({
      where: { id: videoId, userId: session.user.id },
    });

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Get timeline state from metadata
    const projectData = video.metadata ? JSON.parse(video.metadata) : null;
    const tracks = projectData?.tracks || [];

    if (tracks.length === 0) {
      return NextResponse.json(
        { error: 'This project has no timeline to export' },
        { status: 422 },
      );
    }

    // Clips reference MediaAsset ids; the renderer needs real media URLs.
    const assetIds: string[] = Array.from(
      new Set(
        tracks.flatMap((t: any) => (t.clips || []).map((c: any) => c.assetId).filter(Boolean)),
      ),
    );
    const assets = assetIds.length
      ? await prisma.mediaAsset.findMany({
          where: {
            id: { in: assetIds },
            OR: [
              { uploadedById: session.user.id },
              { uploadedById: null, isPublic: true },
            ],
          },
          select: { id: true, url: true },
        })
      : [];
    const urlByAssetId = new Map(assets.map((a) => [a.id, a.url]));

    const exportTracks: ExportTrack[] = tracks.map((t: any) => ({
      id: t.id,
      type: t.type,
      muted: t.muted,
      clips: (t.clips || []).map((c: any) => ({
        id: c.id,
        source: c.assetId ? urlByAssetId.get(c.assetId) : undefined,
        startTime: c.startTime,
        duration: c.duration,
        trimStart: c.trimStart,
        muted: c.muted,
        text: c.text,
      })),
    }));

    // Fail visibly rather than silently skipping clips we cannot resolve.
    const unresolved = exportTracks
      .filter((t) => t.type !== 'text')
      .flatMap((t) => t.clips)
      .filter((c) => !c.source);
    if (unresolved.length > 0) {
      return NextResponse.json(
        {
          error: 'Some clips reference media that no longer exists',
          clipIds: unresolved.map((c) => c.id),
        },
        { status: 422 },
      );
    }

    if (!exportTracks.some((t) => t.type === 'video' && t.clips.length > 0)) {
      return NextResponse.json(
        { error: 'Timeline has no video clips to export' },
        { status: 422 },
      );
    }

    // Create export record
    const exportId = `export-${crypto.randomUUID()}`;

    // Watermark is resolved from the OWNER's plan, server-side. Whatever the
    // client sent for `watermarkText` is discarded — otherwise the editor
    // export is a clean-video loophole around the generation plan gate.
    const branding = await resolveBranding(video.userId);
    const exportSettings = {
      ...(settings || { format: 'mp4' as const, quality: 'hd' as const, fps: 30 }),
      watermarkText: branding.watermarkText,
    };

    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `${exportId}.${exportSettings.format}`);
    const duration = tracks.length > 0 
      ? Math.max(...tracks.flatMap((t: any) => t.clips.map((c: any) => c.startTime + c.duration))) 
      : 10;

    // Save export record to database
    const videoExport = await prisma.videoExport.create({
      data: {
        id: exportId,
        videoId: videoId,
        format: exportSettings.format,
        quality: exportSettings.quality,
        status: 'PROCESSING',
        progress: 0,
      },
    });

    // Start export in background (fire and forget for now)
    // In production, this should be handled by a job queue
    (async () => {
      try {
        console.log(`[Editor Export] Starting export ${exportId}...`);
        
        const finalVideoPath = await exportTimelineVideo(
          exportTracks,
          exportSettings,
          outputPath,
        );

        console.log(`[Editor Export] Video rendered: ${finalVideoPath}`);
        
        // Upload to Cloudinary for CDN delivery
        let cdnUrl = finalVideoPath; // Fallback to local path if upload fails
        try {
          console.log('[Editor Export] Uploading to Cloudinary CDN...');
          const uploadResult = await uploadVideo(finalVideoPath, {
            folder: `forgevid/exports/${exportId}`,
            resource_type: 'video',
          });
          cdnUrl = uploadResult.secure_url;
          console.log('[Editor Export] CDN upload successful:', cdnUrl);
        } catch (uploadError) {
          console.error('[Editor Export] CDN upload failed, using local file:', uploadError);
        }
        
        // Clean up local file after upload
        if (fs.existsSync(finalVideoPath)) {
          fs.unlinkSync(finalVideoPath);
        }

        // Update export record with CDN URL
        await prisma.videoExport.update({
          where: { id: exportId },
          data: {
            status: 'COMPLETED',
            progress: 100,
            fileUrl: cdnUrl, // CDN URL from Cloudinary
          },
        });

        // Send export-complete email notification
        if (session.user.email) {
          sendExportCompleteEmail(
            session.user.email,
            session.user.name || 'Creator',
            video.title || 'Untitled Video',
            cdnUrl,
            {
              duration: `${Math.round(duration)}s`,
              resolution: exportSettings.quality === 'hd' ? '1920x1080' : '1280x720',
              fileSize: 'Calculating...',
            }
          ).catch((err) => console.error('[Email] Export email failed:', err));
        }

        console.log(`[Editor Export] Export ${exportId} completed successfully`);
      } catch (error) {
        console.error(`[Editor Export] Export ${exportId} failed:`, error);
        await prisma.videoExport.update({
          where: { id: exportId },
          data: {
            status: 'FAILED',
          },
        });
      }
    })();

    return NextResponse.json({
      success: true,
      message: 'Export started',
      exportId,
      status: 'processing',
    });
  } catch (error) {
    console.error('[Editor Export] Error:', error);
    return NextResponse.json(
      { error: 'Failed to start export' },
      { status: 500 }
    );
  }
}

export const POST = securityConfigs.authenticated(handlePost);
