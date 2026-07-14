import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { cleanAiTextResponse } from "@/lib/ai-text";
import { prisma } from "@/lib/db";
import { enforceAiCooldown, type ModelMode, OpenRouterError, openRouterChat } from "@/lib/openrouter";
import { studyLanguageInstruction } from "@/lib/study-language";
import { tutorSchema } from "@/lib/validators";

const modeInstruction = {
  default: "Answer as a patient tutor. Teach the idea and ask one check-for-understanding question.",
  eli5: "Explain like the learner is five, using a simple analogy without being condescending.",
  example: "Give a concrete example, then connect the example back to the concept.",
  quiz: "Ask two short quiz questions and wait for the learner to answer.",
  step: "Help solve step by step. Do not simply give final homework answers; guide the reasoning first.",
};

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = tutorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid tutor message.", 422);

  const mode = (parsed.data.modelMode || user.setting?.aiModelMode || "auto-free") as ModelMode;
  const manualModel = parsed.data.manualModel || user.setting?.manualModel;
  const language = studyLanguageInstruction(user.setting?.studyLanguage);

  try {
    await enforceAiCooldown(user.id, "tutor", 4);
    const thread = parsed.data.threadId
      ? await prisma.tutorThread.findFirst({
          where: { id: parsed.data.threadId, userId: user.id },
          include: { messages: { orderBy: { createdAt: "asc" }, take: 12 } },
        })
      : await prisma.tutorThread.create({
          data: { userId: user.id, subject: parsed.data.subject, title: `${parsed.data.subject} tutor` },
          include: { messages: true },
        });

    if (!thread) return jsonError("Tutor thread not found.", 404, "THREAD_NOT_FOUND");

    await prisma.tutorMessage.create({
      data: { threadId: thread.id, role: "user", content: parsed.data.message },
    });

    const answer = cleanAiTextResponse(await openRouterChat({
      mode,
      manualModel,
      userId: user.id,
      temperature: 0.55,
      messages: [
        {
          role: "system",
          content: `You are StudyForge AI's tutor for ${parsed.data.subject}. ${modeInstruction[parsed.data.mode]} If the learner only sends a vague test or greeting, briefly ask what subject or problem they want help with. If this looks like homework, teach the reasoning first and avoid dumping only the final answer. Use readable spacing and short sections. ${language.prompt}`,
        },
        ...thread.messages.map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
        })),
        { role: "user", content: parsed.data.message },
      ],
    }));

    await prisma.tutorMessage.create({
      data: { threadId: thread.id, role: "assistant", content: answer },
    });

    return NextResponse.json({ threadId: thread.id, message: answer });
  } catch (error) {
    const aiError = error as OpenRouterError;
    return jsonError(aiError.message, aiError.status || 500, aiError.code || "AI_ERROR");
  }
}
