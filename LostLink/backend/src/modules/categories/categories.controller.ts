import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
} from "@nestjs/common";

import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiParam,
} from "@nestjs/swagger";

import { CategoriesService } from "./categories.service";

@ApiTags("Categories")
@Controller("categories")
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Get all active categories",
  })
  @ApiOkResponse({
    description: "Active categories retrieved successfully",
  })
  findAll() {
    return this.categoriesService.findAll();
  }

  @Get(":id/fields")
  @ApiOperation({
    summary: "Get dynamic fields of a category",
  })
  @ApiParam({
    name: "id",
    description: "Category UUID",
  })
  @ApiOkResponse({
    description: "Category fields retrieved successfully",
  })
  @ApiBadRequestResponse({
    description: "Invalid category UUID",
  })
  @ApiNotFoundResponse({
    description: "Category not found",
  })
  findFields(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.categoriesService.findFieldsByCategory(id);
  }
}