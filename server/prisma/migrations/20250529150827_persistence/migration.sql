-- CreateTable
CREATE TABLE "GameState" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,
    "player_identifier" TEXT NOT NULL,
    "game_history" JSONB NOT NULL,
    "game_history_summary" TEXT,
    "last_dashboard_updates" JSONB NOT NULL,
    "last_game_state_indicators" JSONB NOT NULL,
    "current_prompt_type" TEXT NOT NULL,
    "current_narrative_language" TEXT NOT NULL,
    "last_suggested_actions" JSONB NOT NULL,
    "panel_states" JSONB NOT NULL,
    "model_name_used" TEXT,
    "theme_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserThemeInteraction" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,
    "is_playing" BOOLEAN NOT NULL DEFAULT false,
    "is_liked" BOOLEAN NOT NULL DEFAULT false,
    "last_played_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserThemeInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameState_user_id_idx" ON "GameState"("user_id");

-- CreateIndex
CREATE INDEX "GameState_theme_id_idx" ON "GameState"("theme_id");

-- CreateIndex
CREATE UNIQUE INDEX "GameState_user_id_theme_id_key" ON "GameState"("user_id", "theme_id");

-- CreateIndex
CREATE INDEX "UserThemeInteraction_user_id_idx" ON "UserThemeInteraction"("user_id");

-- CreateIndex
CREATE INDEX "UserThemeInteraction_theme_id_idx" ON "UserThemeInteraction"("theme_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserThemeInteraction_user_id_theme_id_key" ON "UserThemeInteraction"("user_id", "theme_id");

-- AddForeignKey
ALTER TABLE "GameState" ADD CONSTRAINT "GameState_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserThemeInteraction" ADD CONSTRAINT "UserThemeInteraction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
