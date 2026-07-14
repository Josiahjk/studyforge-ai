import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("studyforge123", 12);

  const user = await prisma.user.upsert({
    where: { email: "demo@studyforge.local" },
    update: {},
    create: {
      email: "demo@studyforge.local",
      name: "Demo Learner",
      passwordHash,
      stats: {
        create: {
          streak: 3,
          xp: 460,
          level: 4,
          dailyGoal: 20,
          dailyReviewed: 8,
          accuracyAvg: 82,
        },
      },
      setting: {
        create: {
          aiModelMode: "auto-free",
          studyLanguage: "en",
        },
      },
      badges: {
        create: [
          {
            code: "first-review",
            label: "First Forge",
            description: "Completed a first review session.",
          },
          {
            code: "streak-3",
            label: "Three-Day Spark",
            description: "Kept a three-day study streak.",
          },
        ],
      },
    },
  });

  const biology = await prisma.deck.upsert({
    where: { id: "seed-biology" },
    update: { userId: user.id },
    create: {
      id: "seed-biology",
      userId: user.id,
      title: "Cell Biology Basics",
      description: "Core concepts for membranes, organelles, and energy.",
      subject: "Biology",
      color: "#1f9d8a",
      tagsJson: JSON.stringify(["science", "exam"]),
      cards: {
        create: [
          {
            type: "qa",
            question: "What is the primary role of the cell membrane?",
            answer:
              "It controls what enters and leaves the cell while helping maintain homeostasis.",
            difficulty: "easy",
            tagsJson: JSON.stringify(["cells"]),
          },
          {
            type: "mcq",
            question: "Which organelle produces most ATP in eukaryotic cells?",
            answer: "Mitochondrion",
            optionsJson: JSON.stringify([
              "Ribosome",
              "Mitochondrion",
              "Golgi apparatus",
              "Lysosome",
            ]),
            correctOption: 1,
            explanation:
              "Mitochondria run cellular respiration, which produces ATP from glucose and oxygen.",
            difficulty: "medium",
            tagsJson: JSON.stringify(["energy"]),
          },
          {
            type: "cloze",
            question: "Fill the blank: Photosynthesis converts light energy into chemical energy stored as ____.",
            answer: "glucose",
            clozeText:
              "Photosynthesis converts light energy into chemical energy stored as {{c1::glucose}}.",
            difficulty: "medium",
            tagsJson: JSON.stringify(["plants"]),
          },
        ],
      },
    },
  });

  await prisma.deck.upsert({
    where: { id: "seed-history" },
    update: { userId: user.id },
    create: {
      id: "seed-history",
      userId: user.id,
      title: "World History Snapshots",
      description: "Quick active-recall prompts for major turning points.",
      subject: "History",
      color: "#dc6b45",
      tagsJson: JSON.stringify(["history", "essay"]),
      cards: {
        create: [
          {
            type: "qa",
            question: "Why was the printing press important in early modern Europe?",
            answer:
              "It made books cheaper and faster to produce, spreading ideas more widely.",
            difficulty: "medium",
            tagsJson: JSON.stringify(["technology"]),
          },
          {
            type: "qa",
            question: "What is one major cause of the Industrial Revolution?",
            answer:
              "Access to coal, new machines, capital investment, and labor shifts all helped accelerate industrialization.",
            difficulty: "hard",
            tagsJson: JSON.stringify(["industry"]),
          },
        ],
      },
    },
  });

  await prisma.quizAttempt.create({
    data: {
      userId: user.id,
      deckId: biology.id,
      score: 4,
      total: 5,
      questionsJson: JSON.stringify([]),
      answersJson: JSON.stringify([]),
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
