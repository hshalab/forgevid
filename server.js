const express = require('express');
const next = require('next');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

function getAllowedOrigins() {
  if (dev) {
    return ['http://localhost:3000', 'http://localhost:3001'];
  }

  return (process.env.ALLOWED_ORIGINS || process.env.PRODUCTION_DOMAINS)?.split(',').map(origin => origin.trim()).filter(Boolean) || [
    'https://forgevid.com',
    'https://www.forgevid.com',
    'https://app.forgevid.com',
  ];
}

function verifySocketToken(token) {
  if (!token || !process.env.JWT_SECRET) {
    return null;
  }

  try {
    return jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'forgevid',
      audience: 'forgevid-collaboration',
    });
  } catch {
    return null;
  }
}

// Security configuration
const securityConfig = {
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", "https://api.stripe.com", "https://api.pexels.com"],
        frameSrc: ["'self'", "https://js.stripe.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  },
  cors: {
    origin: (origin, callback) => {
      const allowed = getAllowedOrigins();

      // Allow same-origin or no origin (curl, server-to-server)
      if (!origin || allowed.includes(origin)) {
        return callback(null, true)
      }
      // Return null instead of Error to prevent 500, CORS library will handle 403
      return callback(null, false)
    },
    credentials: true,
    optionsSuccessStatus: 200,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    /*
     * This is a coarse per-IP flood guard, nothing more. Real quotas live
     * per-user in lib/quota.ts and lib/api-security.ts.
     *
     * It has to be generous, because normal use of this product is chatty:
     * rendering one video polls /api/ai/jobs every 2 seconds for as long as
     * the render takes. At the old budget of 300, generating a single video
     * locked the user out of their own application for fifteen minutes.
     */
    max: 600,
    message: {
      error: 'Too many requests from this IP, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // 1. STATIC ASSETS ARE NOT REQUESTS WORTH LIMITING.
      //
      // These used to be counted, and a single Next.js page load pulls well
      // over 100 chunks/styles/fonts. So the app rate-limited ITSELF: /_next
      // chunks came back as 429 JSON, the browser refused them ("MIME type
      // application/json is not executable"), React never hydrated, and the
      // page was dead.
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (
          req.path.startsWith('/_next/') ||
          req.path.startsWith('/static/') ||
          req.path.startsWith('/videos/') ||
          req.path.startsWith('/images/') ||
          req.path.startsWith('/generated/') ||
          req.path.startsWith('/uploads/') ||
          req.path.startsWith('/music/') ||
          req.path === '/favicon.ico' ||
          req.path === '/robots.txt' ||
          req.path === '/sitemap.xml' ||
          req.path === '/api/health' ||
          req.path === '/api/monitoring/health'
        ) {
          return true;
        }
      }

      // 1b. Next's dev overlay (stack frames, launch-editor) fires constantly
      // while you work and lives outside /_next.
      if (dev && req.path.startsWith('/__nextjs')) {
        return true;
      }

      // 2. THE APP CALLING ITSELF IS NOT USER TRAFFIC.
      //
      // middleware/security.ts POSTs to /api/internal/rate-limit on every
      // request it handles, so each real request was being counted TWICE:
      // once for itself and once for the loopback call it triggers.
      if (req.path.startsWith('/api/internal/')) {
        return true;
      }

      // 3. PROGRESS POLLING IS NOT ABUSE.
      //
      // The client polls this while a render runs; the count is dictated by how
      // long ffmpeg takes, not by the user. It is authenticated, it is a single
      // indexed read, and it is the request most likely to trip a flood guard
      // for someone doing exactly what they paid for.
      if (req.method === 'GET' && req.path.startsWith('/api/ai/jobs/')) {
        return true;
      }

      return false;
    },
  },
};

app.prepare().then(() => {
  const server = express();
  
  // Security middleware
  server.use(helmet(securityConfig.helmet));
  
  // Explicit CORS blocking middleware (before CORS handler)
  server.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowed = getAllowedOrigins();
      if (!allowed.includes(origin)) {
        return res.status(403).json({ error: 'CORS policy: Origin not allowed' });
      }
    }
    next();
  });
  
  server.use(cors(securityConfig.cors));
  server.use(rateLimit(securityConfig.rateLimit));
  
  // Trust proxy — set based on infrastructure depth
  // Use 'loopback' in production to only trust localhost proxies, 
  // or set to the number of proxy layers (e.g., 2 for ALB + Nginx)
  server.set('trust proxy', process.env.TRUST_PROXY_DEPTH ? parseInt(process.env.TRUST_PROXY_DEPTH) : 1);
  
  // NO body parsers here. express.json()/urlencoded() DRAIN the request
  // stream before Next's route handlers run, so every `await req.json()` in
  // app/api/** hangs forever (GETs worked, every POST died). Nothing in this
  // file reads req.body; Next parses bodies itself. If an express-only route
  // ever needs parsing, mount the parser on that specific path only.

  // Request logging
  server.use((req, res, next) => {
    const start = Date.now();
    const originalSend = res.send;
    
    res.send = function(data) {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
      originalSend.call(this, data);
    };
    
    next();
  });

  const httpServer = http.createServer(server);
  const io = new Server(httpServer, {
    cors: {
      origin: dev
        ? ['http://localhost:3000', 'http://localhost:3001']
        : securityConfig.cors.origin,
      methods: ["GET", "POST"],
      credentials: true,
    }
  });

  // WebSocket authentication middleware — verify session cookie before allowing connection
  io.use(async (socket, next) => {
    try {
      const authToken = socket.handshake.auth?.token;
      const tokenUser = verifySocketToken(authToken);
      if (tokenUser) {
        socket.data.user = {
          id: tokenUser.sub,
          name: tokenUser.name,
          email: tokenUser.email,
          role: tokenUser.role,
          organizationId: tokenUser.organizationId,
        };
        return next();
      }

      const cookie = socket.handshake.headers.cookie || '';
      const tokenMatch = cookie.match(/next-auth\.session-token=([^;]+)/);
      if (!tokenMatch) {
        return next(new Error('Authentication required'));
      }
      // Validate the session by calling the NextAuth session endpoint internally
      const sessionRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/auth/session`, {
        headers: { cookie },
      });
      if (!sessionRes.ok) {
        return next(new Error('Invalid session'));
      }
      const session = await sessionRes.json();
      if (!session?.user?.id) {
        return next(new Error('Invalid session'));
      }
      // Attach verified user info to socket
      socket.data.user = { id: session.user.id, name: session.user.name, email: session.user.email };
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  // Socket.IO logic with security and collaboration features
  const rooms = new Map(); // Track rooms and their members
  const userRooms = new Map(); // Track which room each user is in
  
  io.on('connection', (socket) => {
    console.log('User connected:', socket.data.user?.id, socket.id);
    
    // Rate limiting for socket events
    const userRateLimit = new Map();
    const RATE_LIMIT_WINDOW = 60000; // 1 minute
    const MAX_EVENTS_PER_WINDOW = 30;
    
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      userRateLimit.delete(socket.id);
      
      // Clean up room membership
      const roomId = userRooms.get(socket.id);
      if (roomId) {
        leaveRoom(socket, roomId);
      }
    });
    
    // Apply rate limiting to all socket events
    socket.use((packet, next) => {
      const now = Date.now();
      const userLimits = userRateLimit.get(socket.id) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
      
      if (now > userLimits.resetTime) {
        userLimits.count = 0;
        userLimits.resetTime = now + RATE_LIMIT_WINDOW;
      }
      
      if (userLimits.count >= MAX_EVENTS_PER_WINDOW) {
        return next(new Error('Rate limit exceeded'));
      }
      
      userLimits.count++;
      userRateLimit.set(socket.id, userLimits);
      next();
    });

    // Collaboration room management
    function joinRoom(socket, roomId, userInfo) {
      // Leave current room if in one
      const currentRoom = userRooms.get(socket.id);
      if (currentRoom) {
        leaveRoom(socket, currentRoom);
      }
      
      socket.join(roomId);
      userRooms.set(socket.id, roomId);
      
      // Track room members
      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
      }
      rooms.get(roomId).set(socket.id, {
        id: socket.id,
        ...userInfo,
        joinedAt: Date.now(),
      });
      const roomUsers = Array.from(rooms.get(roomId).values());
      
      // Notify others in room
      socket.to(roomId).emit('user:joined', {
        id: socket.id,
        ...userInfo,
      });
      socket.to(roomId).emit('user-joined', {
        user: userInfo,
        roomUsers,
      });
      
      // Send current room members to joining user
      socket.emit('room:members', roomUsers);
      
      console.log(`User ${socket.id} joined room ${roomId}`);
    }

    function leaveRoom(socket, roomId) {
      socket.leave(roomId);
      userRooms.delete(socket.id);
      
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id);
        
        // Clean up empty rooms
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
        }
      }
      const roomUsers = rooms.has(roomId) ? Array.from(rooms.get(roomId).values()) : [];
      
      // Notify others in room
      socket.to(roomId).emit('user:left', { id: socket.id });
      socket.to(roomId).emit('user-left', { id: socket.id, roomUsers });
      
      console.log(`User ${socket.id} left room ${roomId}`);
    }

    // Room events
    socket.on('room:join', ({ roomId, userInfo }) => {
      try {
        joinRoom(socket, roomId, userInfo);
        socket.emit('room:joined', { roomId });
      } catch (error) {
        console.error('Join room error:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    socket.on('join-room', (roomId) => {
      try {
        joinRoom(socket, roomId, socket.data.user);
        const roomUsers = rooms.has(roomId) ? Array.from(rooms.get(roomId).values()) : [];
        socket.emit('room-joined', { roomId, roomUsers, message: `Welcome to room ${roomId}` });
      } catch (error) {
        console.error('Join room error:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    socket.on('room:leave', () => {
      const roomId = userRooms.get(socket.id);
      if (roomId) {
        leaveRoom(socket, roomId);
      }
    });

    // Cursor tracking
    socket.on('cursor:update', (data) => {
      const roomId = userRooms.get(socket.id);
      if (roomId) {
        socket.to(roomId).emit('cursor:update', {
          id: socket.id,
          ...data,
        });
      }
    });

    // Real-time editing events
    socket.on('edit:clip:move', (data) => {
      const roomId = userRooms.get(socket.id);
      if (roomId) {
        socket.to(roomId).emit('edit:clip:move', {
          userId: socket.id,
          ...data,
        });
      }
    });

    socket.on('edit:clip:update', (data) => {
      const roomId = userRooms.get(socket.id);
      if (roomId) {
        socket.to(roomId).emit('edit:clip:update', {
          userId: socket.id,
          ...data,
        });
      }
    });

    socket.on('edit', ({ roomId, edit }) => {
      const activeRoomId = roomId || userRooms.get(socket.id);
      if (activeRoomId) {
        socket.to(activeRoomId).emit('edit-received', {
          userId: socket.data.user.id,
          user: socket.data.user,
          edit,
          timestamp: Date.now(),
        });
        socket.to(activeRoomId).emit('ai-suggestion', {
          message: 'Consider tightening this cut or adding a transition.',
          timestamp: Date.now(),
          type: 'ai-suggestion',
        });
      }
    });

    // Chat messages
    socket.on('chat:message', ({ message }) => {
      const roomId = userRooms.get(socket.id);
      if (roomId) {
        // Sanitize message to prevent XSS
        const sanitized = typeof message === 'string'
          ? message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').slice(0, 2000)
          : '';
        socket.to(roomId).emit('chat:message', {
          userId: socket.id,
          message: sanitized,
          timestamp: Date.now(),
        });
      }
    });

    socket.on('chat-message', ({ roomId, message }) => {
      const activeRoomId = roomId || userRooms.get(socket.id);
      if (activeRoomId) {
        const sanitized = typeof message === 'string'
          ? message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').slice(0, 2000)
          : '';
        io.to(activeRoomId).emit('chat-message-received', {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          roomId: activeRoomId,
          userId: socket.data.user.id,
          user: socket.data.user,
          message: sanitized,
          timestamp: Date.now(),
        });
      }
    });

    socket.on('cursor-move', ({ roomId, cursor }) => {
      const activeRoomId = roomId || userRooms.get(socket.id);
      if (activeRoomId) {
        socket.to(activeRoomId).emit('cursor-moved', {
          userId: socket.data.user.id,
          user: socket.data.user,
          cursor,
          timestamp: Date.now(),
        });
      }
    });

    socket.on('video-state-change', ({ roomId, state }) => {
      const activeRoomId = roomId || userRooms.get(socket.id);
      if (activeRoomId) {
        socket.to(activeRoomId).emit('video-state-changed', { state });
      }
    });

    socket.on('typing', ({ roomId, isTyping }) => {
      const activeRoomId = roomId || userRooms.get(socket.id);
      if (activeRoomId) {
        socket.to(activeRoomId).emit('user-typing', {
          userId: socket.data.user.id,
          user: socket.data.user,
          isTyping: Boolean(isTyping),
        });
      }
    });

    // Presence heartbeat
    socket.on('presence:heartbeat', () => {
      const roomId = userRooms.get(socket.id);
      if (roomId && rooms.has(roomId)) {
        const member = rooms.get(roomId).get(socket.id);
        if (member) {
          member.lastSeen = Date.now();
        }
      }
    });
  });

  // Error handling middleware
  server.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // Next.js pages and API
  server.use((req, res) => handle(req, res));

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
    console.log(`> Environment: ${process.env.NODE_ENV || 'development'}`);

    // Opt-in Growth Operator scheduler. The API atomically claims due rows, so
    // multiple Railway replicas cannot process the same schedule. This only
    // prepares recommendations and operator notifications.
    const schedulerSecret = process.env.CRON_SECRET;
    if (!dev && schedulerSecret) {
      const runSchedules = async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${PORT}/api/internal/growth-operator`, {
            method: 'POST',
            headers: { 'x-cron-secret': schedulerSecret },
          });
          if (!response.ok) console.error(`[Growth scheduler] HTTP ${response.status}`);
        } catch (error) {
          console.error('[Growth scheduler] trigger failed:', error);
        }
      };
      const initialTimer = setTimeout(runSchedules, 60_000);
      const intervalTimer = setInterval(runSchedules, 15 * 60_000);
      initialTimer.unref();
      intervalTimer.unref();
    }
  });
});
