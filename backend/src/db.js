import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
const datasourceUrl = /[?&]connection_limit=/i.test(databaseUrl)
  ? databaseUrl
  : `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}connection_limit=3`;

export const prisma = new PrismaClient({
  datasources: { db: { url: datasourceUrl } },
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
});
