import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';
import { recorderService } from './services/execution/RecorderService';
import { schedulerService } from './services/execution/SchedulerService';

// Import Routes
import { scriptRoutes } from './routes/persistence/scripts';
import { recorderRoutes } from './routes/execution/recorder';
import { projectRoutes } from './routes/persistence/projects';
import { visualTestRouter } from './routes/analysis/visual-tests';
import testDataRoutes from './routes/persistence/test-data';
import { schedulerRouter } from './routes/execution/scheduler';
import { userRoutes } from './routes/persistence/user';
import { gitRoutes } from './routes/integration/git';
import { apiLabRouter } from './routes/integration/api-lab';
import { runnerRoutes } from './routes/execution/runner';
import { settingsRoutes } from './routes/persistence/settings';
import { aiRouter } from './routes/ai/core';
import { authRouter } from './routes/integration/auth';
import { fileSystemRoutes } from './routes/persistence/filesystem';
import aiAnalyticsRoutes from './routes/ai/analytics';
import { suitesRouter } from './routes/persistence/suites';
import performanceRouter from './routes/execution/performance';
import { runsRouter } from './routes/execution/runs';
import { mobileTestRoutes } from './routes/execution/mobile-tests';
import { visionStudioRoutes } from './routes/execution/vision-studio';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 8081;

// Middleware
app.use(cors());
app.use(express.json());

// Request Logging Middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        let statusColor = '';
        if (res.statusCode >= 500) statusColor = '❌';
        else if (res.statusCode >= 400) statusColor = '⚠️';
        else statusColor = '✅';

        console.log(`[HTTP] ${statusColor} ${req.method} ${req.url} -> ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// Auth Middleware (Applied to API routes)
import { authMiddleware } from './middleware/auth';

// Public Routes
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);

// Protected Routes
app.use('/api', authMiddleware);

// Routes Mapping
app.use('/api/mobile-tests', mobileTestRoutes);
app.use('/api/vision-studio', visionStudioRoutes);
app.use('/api/tests', scriptRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/scripts', scriptRoutes);
app.use('/api/runner', runnerRoutes);
app.use('/api/visual', visualTestRouter);
app.use('/api/user', userRoutes);
app.use('/api/fs', fileSystemRoutes);
app.use('/api/ai', aiRouter);
app.use('/api/ai-analytics', aiAnalyticsRoutes);
app.use('/api/recorder', recorderRoutes);
app.use('/api/test-data', testDataRoutes);
app.use('/api/schedules', schedulerRouter);
app.use('/api/git', gitRoutes);
app.use('/api/lab', apiLabRouter);
app.use('/api/suites', suitesRouter);
app.use('/api/settings', settingsRoutes);
app.use('/api/performance', performanceRouter);
app.use('/api/runs', runsRouter);

// Initialize Services
recorderService.setSocket(io);
schedulerService.init().catch(err => console.error("Scheduler Init Failed:", err));

// Initialize TestRunner Socket for real-time logs
import { testRunnerService } from './services/execution/TestRunnerService';
import { visionVisualService } from './services/execution/VisionVisualService';
import { visionRecorderService } from './services/execution/VisionRecorderService';
import { visionActionService } from './services/execution/VisionActionService';

testRunnerService.setSocketIO(io);

// Vision Studio Real-time Handlers
io.on('connection', (socket) => {
    socket.on('vision:stream:start', (serial) => {
        visionVisualService.startStreaming(serial);
        visionVisualService.on('frame', (data) => {
            if (data.serial === serial) {
                socket.emit('vision:frame', data.base64);
            }
        });
    });

    socket.on('vision:record:start', (serial) => {
        visionRecorderService.startRecording(serial);

        // Listen for raw events to update UI line log
        visionRecorderService.on('event', (event) => {
            if (event.serial === serial) {
                socket.emit('vision:raw-event', event);
                // Feed to action recognizer
                visionActionService.processEvent(serial, event);
            }
        });

        // Listen for logical actions (CLICK, SWIPE)
        visionActionService.on('action', (data) => {
            if (data.serial === serial) {
                socket.emit('vision:action', data.step);
            }
        });
    });

    socket.on('disconnect', () => {
        // Cleanup could be added here
    });
});

httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`✅ Test Management Backend running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
