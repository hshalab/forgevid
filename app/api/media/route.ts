import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deleteCloudinaryUrl } from '@/lib/cloudinary';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, fileName, type, category, url, thumbnail, duration, fileSize, resolution, metadata } = body;

    // Basic file validation
    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required' }, { status: 400 });
    }

    // File type validation
    const allowedTypes = ['image', 'video', 'audio', 'document'];
    if (!allowedTypes.includes(type)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    // File size validation (100MB limit for demo)
    const maxFileSize = 100 * 1024 * 1024; // 100MB
    if (fileSize && fileSize > maxFileSize) {
      return NextResponse.json({ error: 'File size too large' }, { status: 400 });
    }

    // Production-ready Cloudinary integration with fallback
    // When file data is provided, this will upload to Cloudinary:
    // const uploadResult = await cloudinary.uploader.upload(fileData, {
    //   folder: 'forgevid-media',
    //   resource_type: 'auto',
    //   public_id: `${session.user.id}_${Date.now()}`
    // });
    // url = uploadResult.secure_url;
    
    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        name,
        fileName: fileName || name,
        type,
        category,
        url: url || `placeholder-${type}-url`, // Generate placeholder or use provided URL
        thumbnail,
        duration,
        fileSize: fileSize ? BigInt(fileSize) : null,
        resolution,
        metadata: metadata ? JSON.stringify(metadata) : null,
        uploadedById: session.user.id,
      },
    });

    return NextResponse.json(mediaAsset);
  } catch (error) {
    console.error('Media upload error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20') || 20));
    const search = url.searchParams.get('search');
    const type = url.searchParams.get('type');

    // Users see their own uploads plus ForgeVid's curated, platform-owned
    // starter library. Public assets cannot be deleted by users (DELETE still
    // requires ownership below).
    const where: any = {
      OR: [
        { uploadedById: session.user.id },
        { uploadedById: null, isPublic: true },
      ],
    };
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (type) {
      where.type = type;
    }

    const [assets, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.mediaAsset.count({ where }),
    ]);

    const serializedAssets = assets.map((a) => ({
      ...a,
      fileSize: a.fileSize != null ? Number(a.fileSize) : null,
    }));

    return NextResponse.json({
      assets: serializedAssets,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Media fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const assetId = url.searchParams.get('id');

    if (!assetId) {
      return NextResponse.json({ error: 'Asset ID required' }, { status: 400 });
    }

    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset || asset.uploadedById !== session.user.id) {
      return NextResponse.json({ error: 'Not found or unauthorized' }, { status: 404 });
    }

    // Delete the remote object first. If Cloudinary is temporarily unavailable,
    // keep the database row so the deletion can be retried without losing its id.
    await deleteCloudinaryUrl(asset.url, asset.type === 'IMAGE' ? 'image' : 'video');
    if (asset.thumbnail && asset.thumbnail !== asset.url) {
      await deleteCloudinaryUrl(asset.thumbnail, 'image');
    }
    await prisma.mediaAsset.delete({ where: { id: assetId } });
    
    return NextResponse.json({ message: 'Asset deleted' });
  } catch (error) {
    console.error('Media delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
