-- CreateTable
CREATE TABLE "user_theme_persisted_lore" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,
    "lore_fragment_key" TEXT NOT NULL,
    "lore_fragment_title" TEXT NOT NULL,
    "lore_fragment_content" TEXT NOT NULL,
    "unlock_condition_description" TEXT NOT NULL,
    "unlocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active_for_new_games" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_theme_persisted_lore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_theme_persisted_lore_user_id_idx" ON "user_theme_persisted_lore"("user_id");

-- CreateIndex
CREATE INDEX "user_theme_persisted_lore_theme_id_idx" ON "user_theme_persisted_lore"("theme_id");

-- CreateIndex
CREATE INDEX "user_theme_persisted_lore_user_id_theme_id_idx" ON "user_theme_persisted_lore"("user_id", "theme_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_theme_persisted_lore_user_id_theme_id_lore_fragment_ke_key" ON "user_theme_persisted_lore"("user_id", "theme_id", "lore_fragment_key");

-- AddForeignKey
ALTER TABLE "user_theme_persisted_lore" ADD CONSTRAINT "user_theme_persisted_lore_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
