-- Уникальность (quizId, orderIndex): защита от дублей вопросов при ретрае/перегенерации (аудит H1)
CREATE UNIQUE INDEX "QuizQuestion_quizId_orderIndex_key" ON "QuizQuestion"("quizId", "orderIndex");
