/*
  Warnings:

  - You are about to drop the column `game_history_lore` on the `GameState` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "GameState" DROP COLUMN "game_history_lore",
ADD COLUMN     "game_history_lore" TEXT;
