import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { Category } from "./entities/category.entity";
import { CategoryField } from "./entities/category-field.entity";

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,

    @InjectRepository(CategoryField)
    private readonly fieldRepository: Repository<CategoryField>,
  ) {}

  // Get all active categories
  async findAll() {
    return this.categoryRepository.find({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
      order: {
        name: "ASC",
      },
    });
  }

  // Get dynamic fields of a specific category
  async findFieldsByCategory(categoryId: string) {
    const category = await this.categoryRepository.findOne({
      where: {
        id: categoryId,
        isActive: true,
      },
    });

    if (!category) {
      throw new NotFoundException("Category not found");
    }

    return this.fieldRepository.find({
      where: {
        category: {
          id: categoryId,
        },
      },
      select: {
        id: true,
        fieldKey: true,
        label: true,
        fieldType: true,
        options: true,
        required: true,
        sortOrder: true,
      },
      order: {
        sortOrder: "ASC",
      },
    });
  }
}