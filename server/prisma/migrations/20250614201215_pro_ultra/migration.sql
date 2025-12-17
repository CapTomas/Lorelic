/*
  Warnings:

  - You are about to drop the column `daily_api_calls` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `hourly_api_calls` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `last_daily_reset` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `last_hourly_reset` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "daily_api_calls",
DROP COLUMN "hourly_api_calls",
DROP COLUMN "last_daily_reset",
DROP COLUMN "last_hourly_reset",
ADD COLUMN     "api_usage" JSONB NOT NULL DEFAULT '{}';
