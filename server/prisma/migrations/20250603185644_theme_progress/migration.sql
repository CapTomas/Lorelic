-- CreateTable
CREATE TABLE "user_theme_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "current_xp" INTEGER NOT NULL DEFAULT 0,
    "max_integrity_bonus" INTEGER NOT NULL DEFAULT 0,
    "max_willpower_bonus" INTEGER NOT NULL DEFAULT 0,
    "aptitude_bonus" INTEGER NOT NULL DEFAULT 0,
    "resilience_bonus" INTEGER NOT NULL DEFAULT 0,
    "acquired_trait_keys" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_theme_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_theme_progress_user_id_idx" ON "user_theme_progress"("user_id");

-- CreateIndex
CREATE INDEX "user_theme_progress_theme_id_idx" ON "user_theme_progress"("theme_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_theme_progress_user_id_theme_id_key" ON "user_theme_progress"("user_id", "theme_id");

-- AddForeignKey
ALTER TABLE "user_theme_progress" ADD CONSTRAINT "user_theme_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
