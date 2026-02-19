import { Router } from 'express';
import { mobileTestController } from '../../controllers/MobileTestController';

const router = Router();

/**
 * @route   GET /api/mobile-tests/devices
 * @desc    Get list of available mobile devices (Android/iOS)
 * @access  Private
 */
router.get('/devices', (req, res) => mobileTestController.getDevices(req, res));

/**
 * @route   POST /api/mobile-tests/execute
 * @desc    Start automated test execution on a mobile device
 * @access  Private
 */
router.post('/execute', (req, res) => mobileTestController.execute(req, res));

export { router as mobileTestRoutes };
