import app from "./app";
import { logger } from "./lib/logger";
import { ensureSprintHubCurriculumV2026 } from "./lib/seedCurriculum";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  ensureSprintHubCurriculumV2026()
    .then((result) => {
      if (result.applied) {
        logger.info({ courseId: result.courseId }, "Sprint Hub curriculum seeded on boot");
      } else {
        logger.info({ reason: result.reason, courseId: result.courseId }, "Sprint Hub curriculum seed skipped");
      }
    })
    .catch((err) => {
      logger.error({ err }, "Sprint Hub curriculum seed failed");
    });
});
