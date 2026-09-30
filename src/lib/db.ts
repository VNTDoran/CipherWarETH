import { PrismaClient } from "@prisma/client";

// Next's dev server hot-reloads modules; without the global cache we'd open a
// new SQLite connection pool on every reload until the process ran out.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
