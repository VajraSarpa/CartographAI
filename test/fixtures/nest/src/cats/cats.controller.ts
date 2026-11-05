import { Controller, Get, Post } from "@nestjs/common";
const dyn = "x";
@Controller("cats")
export class CatsController {
  @Get() list() {}
  @Get(":id") one() {}
  @Post({ path: "bulk" }) bulk() {}
  @Get(dyn) unreadable() {}
}
