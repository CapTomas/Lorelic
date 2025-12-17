import { PrismaClient } from '@prisma/client';
import logger from './utils/logger.js';

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
  logger.info('Prisma Client initialized for production.');
} else {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
    });
    logger.info('New Prisma Client initialized for development.');
  }
  prisma = global.__prisma;
  logger.info('Using existing Prisma Client instance for development.');
}

export default prisma;
