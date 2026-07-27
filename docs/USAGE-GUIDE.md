# ForgeVid Usage Guide

## Table of Contents
1. [Getting Started](#getting-started)
2. [Voice-to-Video Generation](#voice-to-video-generation)
3. [AI-Powered Video Editing](#ai-powered-video-editing)
4. [Advanced Analytics](#advanced-analytics)
5. [Templates & Media Management](#templates--media-management)
6. [Real-Time Collaboration](#real-time-collaboration)
7. [API Reference](#api-reference)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

## Getting Started

### Prerequisites
- Node.js 18+ 
- PostgreSQL database
- Required API keys (see Environment Variables section)

### Environment Variables
Create a `.env.local` file with the following variables:

```bash
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/forgevid"

# Authentication
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key"

# OpenAI API
OPENAI_SECRET_KEY="sk-your-openai-key"

# Stripe (for payments)
STRIPE_SECRET_KEY="sk_test_your-stripe-key"
STRIPE_PUBLISHABLE_KEY="pk_test_your-stripe-key"

# Redis (for real-time features)
REDIS_URL="redis://localhost:6379"

# Email (for notifications)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
```

### Installation
```bash
# Clone the repository
git clone https://github.com/krystinvestments/forgevid.git
cd forgevid

# Install dependencies
npm install

# Set up the database
npx prisma migrate dev
npx prisma db seed

# Start the development server
npm run dev
```

## Voice-to-Video Generation

### Overview
Convert voice recordings into professional videos using AI-powered transcription and video generation.

### Features
- **Multi-language Support**: Supports 50+ languages with automatic detection
- **Voice Styles**: Professional, casual, animated, and documentary styles
- **Quality Options**: 720p, 1080p, and 4K output
- **Real-time Processing**: Fast conversion with progress tracking

### Usage

#### 1. Recording Audio
```typescript
// Start recording
const startRecording = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ 
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 44100,
    } 
  });
  
  const mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.start();
};
```

#### 2. Processing Voice-to-Video
```typescript
// Process voice to video
const processVoiceToVideo = async (audioBlob: Blob, options: VoiceToVideoOptions) => {
  const response = await fetch('/api/voice-to-video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      audio: base64Audio,
      options: {
        language: 'en',
        videoStyle: 'professional',
        duration: 30,
        quality: '1080p'
      }
    }),
  });
  
  return response.json();
};
```

### API Endpoints
- `POST /api/voice-to-video` - Process voice-to-video conversion

## AI-Powered Video Editing

### Overview
Intelligent video editing with AI-powered suggestions and automated enhancements.

### Features
- **Auto Edit Suggestions**: AI analyzes your video and suggests improvements
- **Manual Editing Tools**: Trim, crop, filter, add text overlays
- **Audio Enhancement**: Noise reduction, volume boost, equalizer
- **Batch Processing**: Edit multiple videos simultaneously

### Usage

#### 1. Auto Edit with AI
```typescript
// Generate AI suggestions
const generateSuggestions = async (videoUrl: string, prompt: string) => {
  const response = await fetch('/api/ai-editing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'suggest',
      videoUrl,
      prompt: 'Make this video more engaging'
    }),
  });
  
  return response.json();
};
```

#### 2. Apply Video Edits
```typescript
// Apply specific edit
const applyEdit = async (videoUrl: string, editType: string, parameters: any) => {
  const response = await fetch('/api/ai-editing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'edit',
      videoUrl,
      editType: 'trim',
      parameters: {
        startTime: 10,
        endTime: 60
      }
    }),
  });
  
  return response.json();
};
```

### API Endpoints
- `POST /api/ai-editing` - Video editing operations
  - `action: 'analyze'` - Analyze video properties
  - `action: 'suggest'` - Generate AI suggestions
  - `action: 'edit'` - Apply video edits
  - `action: 'batch_edit'` - Batch edit multiple videos
  - `action: 'thumbnail'` - Generate video thumbnails

## Advanced Analytics

### Overview
Comprehensive video performance analytics with AI-powered insights and recommendations.

### Features
- **Engagement Metrics**: Views, completion rate, click-through rate
- **Audience Insights**: Demographics, behavior patterns, preferences
- **Performance Metrics**: Video quality, loading times, SEO scores
- **AI Insights**: Content analysis, recommendations, predictions

### Usage

#### 1. Generate Analytics Report
```typescript
// Get comprehensive analytics report
const getAnalyticsReport = async (videoId: string, period: string = '30d') => {
  const response = await fetch('/api/analytics-insights', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'report',
      videoId,
      period
    }),
  });
  
  return response.json();
};
```

#### 2. Get Specific Metrics
```typescript
// Get engagement metrics
const getEngagementMetrics = async (videoId: string) => {
  const response = await fetch('/api/analytics-insights', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'engagement',
      videoId
    }),
  });
  
  return response.json();
};
```

### API Endpoints
- `POST /api/analytics-insights` - Analytics operations
  - `action: 'report'` - Generate full analytics report
  - `action: 'engagement'` - Get engagement metrics
  - `action: 'audience'` - Get audience insights
  - `action: 'performance'` - Get performance metrics
  - `action: 'insights'` - Generate AI insights
  - `action: 'compare'` - Compare multiple videos

## Templates & Media Management

### Overview
Extensive library of video templates and media assets with AI-powered template generation.

### Features
- **Template Library**: Professional video templates across business, real estate, automotive, and social media
- **Media Assets**: Images, videos, audio, animations
- **AI Template Generation**: Create custom templates from text prompts
- **Advanced Search**: Filter by category, duration, style, tags

### Usage

#### 1. Search Templates
```typescript
// Search for templates
const searchTemplates = async (filters: TemplateSearchFilters) => {
  const response = await fetch('/api/templates-media', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'search_templates',
      filters: {
        category: ['business', 'social'],
        duration: { min: 30, max: 120 },
        aspectRatio: ['16:9', '9:16']
      }
    }),
  });
  
  return response.json();
};
```

#### 2. Generate AI Template
```typescript
// Generate custom template
const generateTemplate = async (prompt: string) => {
  const response = await fetch('/api/templates-media', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'generate_template',
      prompt: 'Create a modern business presentation template with blue theme'
    }),
  });
  
  return response.json();
};
```

### API Endpoints
- `POST /api/templates-media` - Templates and media operations
  - `action: 'search_templates'` - Search video templates
  - `action: 'search_media'` - Search media assets
  - `action: 'get_template'` - Get specific template
  - `action: 'get_media'` - Get specific media asset
  - `action: 'generate_template'` - Generate AI template
  - `action: 'upload_media'` - Upload media asset
  - `action: 'popular_templates'` - Get popular templates
  - `action: 'recent_templates'` - Get recent templates
  - `action: 'recommended_templates'` - Get recommended templates

## Real-Time Collaboration

### Overview
Multi-user video editing with real-time synchronization and conflict resolution.

### Features
- **Real-time Sync**: Changes appear instantly for all users
- **User Presence**: See who's online and what they're editing
- **Conflict Resolution**: Automatic handling of simultaneous edits
- **Version History**: Track changes and revert to previous versions

### Usage

#### 1. Join Collaboration Room
```typescript
// Join a collaboration session
const joinRoom = (roomId: string, userId: string) => {
  const socket = io('ws://localhost:3000');
  
  socket.emit('join-room', { roomId, userId });
  
  socket.on('user-joined', (user) => {
    console.log(`${user.name} joined the room`);
  });
  
  socket.on('edit-change', (change) => {
    // Apply the change to the video editor
    applyEditChange(change);
  });
};
```

#### 2. Send Edit Changes
```typescript
// Send edit changes to other users
const sendEditChange = (roomId: string, change: EditChange) => {
  socket.emit('edit-change', {
    roomId,
    change,
    timestamp: Date.now()
  });
};
```

## API Reference

### Authentication
All API endpoints require JWT authentication via the `Authorization` header:
```
Authorization: Bearer <your-jwt-token>
```

### Error Handling
All API responses follow this format:
```json
{
  "success": boolean,
  "data": any,
  "message": string,
  "error"?: string
}
```

### Rate Limiting
- **Free Tier**: 100 requests/hour
- **Pro Tier**: 1,000 requests/hour
- **Enterprise**: 10,000 requests/hour

## Troubleshooting

### Common Issues

#### 1. Jest Test Runner Issues
**Problem**: Tests fail with "jest-environment-jsdom cannot be found"
**Solution**:
```bash
npm install --save-dev jest-environment-jsdom
```

#### 2. OpenAI API Errors
**Problem**: "Invalid API key" or rate limit errors
**Solution**:
- Verify `OPENAI_SECRET_KEY` is set correctly
- Check API key permissions and billing
- Implement exponential backoff for rate limits

#### 3. Database Connection Issues
**Problem**: "Connection refused" or timeout errors
**Solution**:
- Verify `DATABASE_URL` is correct
- Ensure PostgreSQL is running
- Check network connectivity

#### 4. Real-time Features Not Working
**Problem**: Socket.io connections failing
**Solution**:
- Verify `REDIS_URL` is set
- Check Redis server is running
- Ensure WebSocket support in browser

#### 5. File Upload Issues
**Problem**: Media uploads failing
**Solution**:
- Check file size limits
- Verify storage permissions
- Ensure proper MIME types

### Performance Optimization

#### 1. Video Processing
- Use appropriate video quality settings
- Implement progress indicators
- Consider background processing for large files

#### 2. Database Queries
- Add proper indexes
- Use connection pooling
- Implement query caching

#### 3. API Responses
- Implement response caching
- Use compression
- Optimize payload sizes

## Best Practices

### 1. Security
- Always validate user input
- Use HTTPS in production
- Implement proper CORS policies
- Regular security audits

### 2. Performance
- Implement lazy loading
- Use CDN for static assets
- Optimize images and videos
- Monitor performance metrics

### 3. Error Handling
- Implement comprehensive error logging
- Provide user-friendly error messages
- Use try-catch blocks appropriately
- Implement retry mechanisms

### 4. Testing
- Write unit tests for all functions
- Implement integration tests
- Use E2E testing for critical flows
- Maintain high test coverage

### 5. Documentation
- Keep API documentation updated
- Document all environment variables
- Provide code examples
- Include troubleshooting guides

## Support

For additional support:
- **Email**: krystinvestments@gmail.com
- **Documentation**: [docs.forgevid.com](https://docs.forgevid.com)
- **GitHub Issues**: [github.com/krystinvestments/forgevid/issues](https://github.com/krystinvestments/forgevid/issues)

---

**Last Updated**: September 7, 2025
**Version**: 1.0.0
