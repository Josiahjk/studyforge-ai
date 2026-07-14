import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { fetchFreeModels, OpenRouterError } from "@/lib/openrouter";

export async function GET() {
  const { user, response } = await requireApiUser();
  if (!user) return response;
  try {
    const models = await fetchFreeModels();
    return NextResponse.json({ models });
  } catch (error) {
    const aiError = error as OpenRouterError;
    return NextResponse.json(
      { error: { message: aiError.message, code: aiError.code || "MODELS_UNAVAILABLE" }, models: [] },
      { status: aiError.status || 503 },
    );
  }
}
