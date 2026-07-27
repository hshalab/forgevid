import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
  prisma: {
    video: {
      findUnique: jest.fn(),
    },
    mediaAsset: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'asset-1', url: 'https://example.com/source.mp4' },
      ]),
    },
    videoExport: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/video-export', () => ({
  exportTimelineVideo: jest.fn().mockResolvedValue('/tmp/export-video.mp4'),
  createPlaceholderVideo: jest.fn().mockResolvedValue('/tmp/placeholder-video.mp4'),
}));

jest.mock('@/lib/cloudinary', () => ({
  uploadVideo: jest.fn().mockResolvedValue({
    public_id: 'forgevid/exports/export-123',
    secure_url: 'https://res.cloudinary.com/forgevid/video/upload/exports/export-123.mp4',
    url: 'http://res.cloudinary.com/forgevid/video/upload/exports/export-123.mp4',
    width: 1920,
    height: 1080,
    duration: 30,
    format: 'mp4',
    bytes: 5000000,
  }),
}));

jest.mock('@/lib/brand-kit', () => ({
  resolveBranding: jest.fn().mockResolvedValue({ watermarkText: 'ForgeVid' }),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

const { getServerSession } = require('next-auth');
const { prisma: mockPrisma } = require('@/lib/prisma');
const { POST } = require('@/app/api/editor/export/route');

describe('Export API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({
      user: { id: 'user-123' },
    });
  });

  describe('POST /api/editor/export', () => {
    it('should create export with default settings', async () => {
      // Mock video exists
      mockPrisma.video.findUnique.mockResolvedValue({
        id: 'video-123',
        userId: 'user-123',
        metadata: '{"tracks":[{"id":"track-1","type":"video","clips":[{"id":"clip-1","assetId":"asset-1","startTime":0,"duration":3}]}]}',
      } as any);

      mockPrisma.videoExport.create.mockResolvedValue({
        id: 'export-123',
        videoId: 'video-123',
        format: 'mp4',
        quality: 'hd',
        status: 'PROCESSING',
        progress: 0,
      } as any);

      mockPrisma.videoExport.update.mockResolvedValue({
        id: 'export-123',
        status: 'COMPLETED',
        progress: 100,
        fileUrl: 'https://res.cloudinary.com/forgevid/video/upload/exports/export-123.mp4',
      } as any);

      const request = new NextRequest('http://localhost:3000/api/editor/export', {
        method: 'POST',
        body: JSON.stringify({
          videoId: 'video-123',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.exportId).toBeDefined();
      expect(data.status).toBe('processing');
      expect(mockPrisma.mediaAsset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: ['asset-1'] },
            OR: [
              { uploadedById: 'user-123' },
              { uploadedById: null, isPublic: true },
            ],
          },
        }),
      );
    });

    it('should handle 4K export settings', async () => {
      mockPrisma.video.findUnique.mockResolvedValue({
        id: 'video-123',
        userId: 'user-123',
        metadata: '{"tracks":[{"id":"track-1","type":"video","clips":[{"id":"clip-1","assetId":"asset-1","startTime":0,"duration":3}]}]}',
      } as any);

      mockPrisma.videoExport.create.mockResolvedValue({
        id: 'export-123',
        videoId: 'video-123',
        format: 'mp4',
        quality: '4k',
        status: 'PROCESSING',
        progress: 0,
      } as any);

      const request = new NextRequest('http://localhost:3000/api/editor/export', {
        method: 'POST',
        body: JSON.stringify({
          videoId: 'video-123',
          settings: {
            format: 'mp4',
            quality: '4k',
            fps: 30,
          },
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should handle social media presets', async () => {
      mockPrisma.video.findUnique.mockResolvedValue({
        id: 'video-123',
        userId: 'user-123',
        metadata: '{"tracks":[{"id":"track-1","type":"video","clips":[{"id":"clip-1","assetId":"asset-1","startTime":0,"duration":3}]}]}',
      } as any);

      mockPrisma.videoExport.create.mockResolvedValue({
        id: 'export-123',
        format: 'mp4',
        quality: 'hd',
        status: 'PROCESSING',
      } as any);

      const request = new NextRequest('http://localhost:3000/api/editor/export', {
        method: 'POST',
        body: JSON.stringify({
          videoId: 'video-123',
          settings: {
            format: 'mp4',
            quality: 'hd',
            fps: 30,
            preset: 'social-youtube',
          },
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should return 401 for unauthenticated users', async () => {
      (getServerSession as jest.Mock).mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/editor/export', {
        method: 'POST',
        body: JSON.stringify({
          videoId: 'video-123',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent video', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/editor/export', {
        method: 'POST',
        body: JSON.stringify({
          videoId: 'non-existent',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(404);
    });

    it('should return 400 for missing videoId', async () => {
      const request = new NextRequest('http://localhost:3000/api/editor/export', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it('should handle WebM format export', async () => {
      mockPrisma.video.findUnique.mockResolvedValue({
        id: 'video-123',
        userId: 'user-123',
        metadata: '{"tracks":[{"id":"track-1","type":"video","clips":[{"id":"clip-1","assetId":"asset-1","startTime":0,"duration":3}]}]}',
      } as any);

      mockPrisma.videoExport.create.mockResolvedValue({
        id: 'export-123',
        format: 'webm',
        quality: 'hd',
        status: 'PROCESSING',
      } as any);

      const request = new NextRequest('http://localhost:3000/api/editor/export', {
        method: 'POST',
        body: JSON.stringify({
          videoId: 'video-123',
          settings: {
            format: 'webm',
            quality: 'hd',
            fps: 30,
          },
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should handle MOV format export', async () => {
      mockPrisma.video.findUnique.mockResolvedValue({
        id: 'video-123',
        userId: 'user-123',
        metadata: '{"tracks":[{"id":"track-1","type":"video","clips":[{"id":"clip-1","assetId":"asset-1","startTime":0,"duration":3}]}]}',
      } as any);

      mockPrisma.videoExport.create.mockResolvedValue({
        id: 'export-123',
        format: 'mov',
        quality: 'hd',
        status: 'PROCESSING',
      } as any);

      const request = new NextRequest('http://localhost:3000/api/editor/export', {
        method: 'POST',
        body: JSON.stringify({
          videoId: 'video-123',
          settings: {
            format: 'mov',
            quality: 'hd',
            fps: 30,
          },
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });
});

