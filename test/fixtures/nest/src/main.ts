import { NestFactory } from "@nestjs/core";
import { CatsController } from "./cats/cats.controller";
async function bootstrap() { const app = await NestFactory.create(CatsController); app.setGlobalPrefix("api"); }
bootstrap();
