/*
  Warnings:

  - A unique constraint covering the columns `[email_confirmation_token]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email_confirmation_expires_at" TIMESTAMP(3),
ADD COLUMN     "email_confirmation_token" TEXT,
ADD COLUMN     "email_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_confirmation_token_key" ON "User"("email_confirmation_token");
