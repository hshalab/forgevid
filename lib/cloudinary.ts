/**
 * Cloudinary Configuration for Video and Image Upload
 * Handles video uploads, transformations, and storage
 */

import { v2 as cloudinary } from 'cloudinary';
import { withProviderReliability } from './provider-reliability';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export interface UploadOptions {
  folder?: string;
  resource_type?: 'image' | 'video' | 'raw' | 'auto';
  transformation?: any;
  quality?: string | number;
  format?: string;
}

export interface UploadResult {
  public_id: string;
  secure_url: string;
  url: string;
  width?: number;
  height?: number;
  duration?: number;
  format: string;
  bytes: number;
}

/**
 * Upload a video file to Cloudinary
 */
export async function uploadVideo(
  filePath: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  try {
    const result = await withProviderReliability('cloudinary', () => cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      folder: options.folder || 'forgevid/videos',
      quality: 'auto',
      fetch_format: 'auto',
      ...options,
    }));

    return {
      public_id: result.public_id,
      secure_url: result.secure_url,
      url: result.url,
      width: result.width,
      height: result.height,
      duration: result.duration,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (error) {
    console.error('Cloudinary video upload error:', error);
    throw new Error(`Failed to upload video: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Upload a buffer to Cloudinary
 */
export async function uploadBuffer(
  buffer: Buffer,
  options: UploadOptions = {}
): Promise<UploadResult> {
  try {
    return withProviderReliability('cloudinary', () => new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          folder: options.folder || 'forgevid/videos',
          quality: 'auto',
          fetch_format: 'auto',
          ...options,
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            reject(error);
          } else if (result) {
            resolve({
              public_id: result.public_id,
              secure_url: result.secure_url,
              url: result.url,
              width: result.width,
              height: result.height,
              duration: result.duration,
              format: result.format,
              bytes: result.bytes,
            });
          }
        }
      );

      uploadStream.end(buffer);
    }));
  } catch (error) {
    console.error('Cloudinary buffer upload error:', error);
    throw new Error(`Failed to upload buffer: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Upload an image file to Cloudinary
 */
export async function uploadImage(
  filePath: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  try {
    const result = await withProviderReliability('cloudinary', () => cloudinary.uploader.upload(filePath, {
      resource_type: 'image',
      folder: options.folder || 'forgevid/images',
      quality: 'auto',
      fetch_format: 'auto',
      ...options,
    }));

    return {
      public_id: result.public_id,
      secure_url: result.secure_url,
      url: result.url,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (error) {
    console.error('Cloudinary image upload error:', error);
    throw new Error(`Failed to upload image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Delete a resource from Cloudinary
 */
export async function deleteResource(publicId: string, resourceType: 'image' | 'video' = 'video'): Promise<void> {
  try {
    await withProviderReliability('cloudinary', () => cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    }));
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error(`Failed to delete resource: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get video thumbnail
 */
export function getVideoThumbnail(publicId: string, options: { width?: number; height?: number } = {}): string {
  return cloudinary.url(publicId, {
    resource_type: 'video',
    transformation: [
      { width: options.width || 1280, height: options.height || 720, crop: 'limit' },
      { quality: 'auto' },
      { fetch_format: 'auto' },
    ],
  });
}

/**
 * Generate video with transformations
 */
export function getVideoTransformation(
  publicId: string,
  transformations: any[] = []
): string {
  return cloudinary.url(publicId, {
    resource_type: 'video',
    transformation: transformations,
  });
}

export { cloudinary };

