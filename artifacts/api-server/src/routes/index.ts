import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import devAuthRouter, { assertDevLoginSafeAtBoot } from "./devAuth";
import meRouter from "./me";
import adminRouter from "./admin";
import storageRouter from "./storage";
import agreementsRouter from "./agreements";
import analyticsRouter from "./analytics";
import documentsRouter from "./documents";
import threadsRouter from "./threads";
import coursesRouter from "./courses";

assertDevLoginSafeAtBoot();

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
if (process.env.NODE_ENV === "development") {
  router.use(devAuthRouter);
}
router.use(meRouter);
router.use(adminRouter);
router.use(storageRouter);
router.use(agreementsRouter);
router.use(analyticsRouter);
router.use(documentsRouter);
router.use(threadsRouter);
router.use(coursesRouter);

export default router;
