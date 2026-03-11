import { Router } from 'express';
import { deviceRoutes } from './deviceRoutes';
import { sessionRoutes } from './sessionRoutes';
import { interactionRoutes } from './interactionRoutes';
import { inspectorRoutes } from './inspectorRoutes';
import { scriptRoutes } from './scriptRoutes';
import { runRoutes } from './runRoutes';

export const mobileRouter = Router();

// All subroutes mounted under /api/mobile/...
mobileRouter.use('/', deviceRoutes);
mobileRouter.use('/', sessionRoutes);
mobileRouter.use('/', interactionRoutes);
mobileRouter.use('/', inspectorRoutes);
mobileRouter.use('/', scriptRoutes);
mobileRouter.use('/', runRoutes);
