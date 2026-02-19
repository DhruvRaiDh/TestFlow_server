import { Router } from 'express';
import { visionStudioController } from '../../controllers/VisionStudioController';

const router = Router();

/**
 * @route   GET /api/vision-studio/avds
 * @desc    Get list of Android Virtual Devices from Android Studio
 * @access  Private
 */
router.get('/avds', (req, res) => visionStudioController.getAVDs(req, res));

/**
 * @route   POST /api/vision-studio/launch
 * @desc    Launch an Android Virtual Device
 * @access  Private
 */
router.post('/launch', (req, res) => visionStudioController.launchAVD(req, res));

/**
 * @route   GET /api/vision-studio/logs
 * @desc    Get recent backend logs for Vision Studio
 * @access  Private
 */
router.get('/logs', (req, res) => visionStudioController.getLogs(req, res));

export { router as visionStudioRoutes };
