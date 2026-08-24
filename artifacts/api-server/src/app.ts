import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
// Explicit body caps. Large binary uploads always go through dedicated multer
// routes with their own per-route caps (25–50MB). 5MB on the JSON parser is
// generous enough for the largest legitimate JSON payload we expect (an AI
// course-draft prompt that pastes a long transcript, or an agreement-builder
// template with many fields) while still cutting off JSON-bomb style DoS.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(authMiddleware);

app.use("/api", router);

export default app;
