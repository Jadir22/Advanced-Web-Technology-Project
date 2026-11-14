
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";
import { Repository } from "typeorm";

import { User } from "../users/entities/user.entity";
import { Category } from "../categories/entities/category.entity";
import { CategoryField } from "../categories/entities/category-field.entity";

import {
  Report,
  ReportStatus,
  ReportType,
} from "./entities/report.entity";

import { ReportArea } from "./entities/report-area.entity";
import { ReportAttribute } from "./entities/report-attribute.entity";

export interface CreateReportAreaInput {
  areaName: string;
  specificPlace?: string | null;
}

export interface CreateReportAttributeInput {
  categoryFieldId: string;
  value: string;
}

export interface CreateReportInput {
  categoryId: string;
  reportType: ReportType;
  title: string;
  description: string;
  eventDate: string;
  areas: CreateReportAreaInput[];
  attributes: CreateReportAttributeInput[];
}

export interface CreatedReportResult {
  id: string;
  categoryId: string;
  reportType: ReportType;
  title: string;
  eventDate: string;
  status: ReportStatus;
}

export interface OwnedReportResult extends CreatedReportResult {
  description: string;
  areas: {
    areaName: string;
    specificPlace: string | null;
  }[];
  attributes: {
    categoryFieldId: string;
    fieldKey: string;
    value: string;
  }[];
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,
  ) {}

  private validateDate(value: string): void {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      throw new BadRequestException(
        "Event date must use YYYY-MM-DD format",
      );
    }

    const timestamp = Date.parse(
      `${value}T00:00:00.000Z`,
    );

    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(
        "Invalid calendar date",
      );
    }
  }

  private validateText(
    value: unknown,
    name: string,
    maximumLength: number,
  ): string {
    if (typeof value !== "string") {
      throw new BadRequestException(
        `${name} must be a string`,
      );
    }

    const normalized = value.trim();

    if (
      normalized.length === 0 ||
      normalized.length > maximumLength
    ) {
      throw new BadRequestException(
        `${name} must contain 1 to ${maximumLength} characters`,
      );
    }

    return normalized;
  }

  private validateInput(input: CreateReportInput): {
    title: string;
    description: string;
    areas: {
      areaName: string;
      specificPlace: string | null;
    }[];
  } {
    if (!input || typeof input !== "object") {
      throw new BadRequestException(
        "Report data is required",
      );
    }

    if (!isUUID(input.categoryId)) {
      throw new BadRequestException(
        "Invalid category UUID",
      );
    }

    if (
      input.reportType !== ReportType.LOST &&
      input.reportType !== ReportType.FOUND
    ) {
      throw new BadRequestException(
        "Report type must be LOST or FOUND",
      );
    }

    const title = this.validateText(
      input.title,
      "Title",
      200,
    );

    const description = this.validateText(
      input.description,
      "Description",
      2000,
    );

    this.validateDate(input.eventDate);

    if (
      !Array.isArray(input.areas) ||
      input.areas.length < 1 ||
      input.areas.length > 5
    ) {
      throw new BadRequestException(
        "A report must contain 1 to 5 areas",
      );
    }

    if (
      !Array.isArray(input.attributes) ||
      input.attributes.length > 30
    ) {
      throw new BadRequestException(
        "Invalid report attributes",
      );
    }

    const areas = input.areas.map((area) => {
      if (!area || typeof area !== "object") {
        throw new BadRequestException(
          "Invalid report area",
        );
      }

      const areaName = this.validateText(
        area.areaName,
        "Area name",
        150,
      );

      let specificPlace: string | null = null;

      if (
        area.specificPlace !== undefined &&
        area.specificPlace !== null &&
        area.specificPlace.trim() !== ""
      ) {
        specificPlace = this.validateText(
          area.specificPlace,
          "Specific place",
          255,
        );
      }

      return {
        areaName,
        specificPlace,
      };
    });

    return {
      title,
      description,
      areas,
    };
  }

  private validateAttributes(
    inputAttributes: CreateReportAttributeInput[],
    availableFields: CategoryField[],
  ): {
    field: CategoryField;
    value: string;
  }[] {
    const fieldMap = new Map(
      availableFields.map((field) => [
        field.id,
        field,
      ]),
    );

    const providedFieldIds = new Set<string>();

    const validated: {
      field: CategoryField;
      value: string;
    }[] = [];

    for (const attribute of inputAttributes) {
      if (
        !attribute ||
        typeof attribute !== "object" ||
        !isUUID(attribute.categoryFieldId)
      ) {
        throw new BadRequestException(
          "Invalid category field ID",
        );
      }

      if (providedFieldIds.has(attribute.categoryFieldId)) {
        throw new BadRequestException(
          "Duplicate category field",
        );
      }

      providedFieldIds.add(attribute.categoryFieldId);

      const field = fieldMap.get(
        attribute.categoryFieldId,
      );

      if (!field) {
        throw new BadRequestException(
          "Category field does not belong to selected category",
        );
      }

      const value = this.validateText(
        attribute.value,
        field.label,
        500,
      );

      if (field.fieldType === "number") {
        if (
          !/^-?\d+(?:\.\d+)?$/.test(value) ||
          !Number.isFinite(Number(value))
        ) {
          throw new BadRequestException(
            `${field.label} must be a valid number`,
          );
        }
      } else if (field.fieldType === "select") {
        if (
          !Array.isArray(field.options) ||
          !field.options.includes(value)
        ) {
          throw new BadRequestException(
            `Invalid option for ${field.label}`,
          );
        }
      } else if (field.fieldType !== "text") {
        throw new BadRequestException(
          `Unsupported field type: ${field.fieldType}`,
        );
      }

      validated.push({
        field,
        value,
      });
    }

    for (const field of availableFields) {
      if (
        field.required &&
        !providedFieldIds.has(field.id)
      ) {
        throw new BadRequestException(
          `Required field missing: ${field.label}`,
        );
      }
    }

    return validated;
  }

  async createReport(
    actorUserId: string,
    input: CreateReportInput,
  ): Promise<CreatedReportResult> {
    if (!isUUID(actorUserId)) {
      throw new BadRequestException(
        "Invalid user UUID",
      );
    }

    const normalized = this.validateInput(input);

    return this.reportRepository.manager.transaction(
      async (manager) => {
        const userRepository =
          manager.getRepository(User);

        const categoryRepository =
          manager.getRepository(Category);

        const categoryFieldRepository =
          manager.getRepository(CategoryField);

        const reportRepository =
          manager.getRepository(Report);

        const areaRepository =
          manager.getRepository(ReportArea);

        const attributeRepository =
          manager.getRepository(ReportAttribute);

        // Only active registered users can submit reports.
        const user = await userRepository.findOne({
          where: {
            id: actorUserId,
            isActive: true,
          },
        });

        if (!user) {
          throw new ForbiddenException(
            "User is not active or does not exist",
          );
        }

        // Category must exist and be active.
        const category =
          await categoryRepository.findOne({
            where: {
              id: input.categoryId,
              isActive: true,
            },
          });

        if (!category) {
          throw new NotFoundException(
            "Active category not found",
          );
        }

        // Get valid fields belonging to this category.
        const availableFields =
          await categoryFieldRepository.find({
            where: {
              category: {
                id: category.id,
              },
            },
          });

        const attributes = this.validateAttributes(
          input.attributes,
          availableFields,
        );

        // Create the parent report.
        const report = reportRepository.create({
          user,
          category,
          reportType: input.reportType,
          title: normalized.title,
          description: normalized.description,
          eventDate: input.eventDate,
          status: ReportStatus.OPEN,
        });

        const savedReport =
          await reportRepository.save(report);

        // Save report locations.
        const areas = normalized.areas.map(
          (area) =>
            areaRepository.create({
              report: savedReport,
              areaName: area.areaName,
              specificPlace: area.specificPlace,
            }),
        );

        await areaRepository.save(areas);

        // Save validated dynamic attributes.
        if (attributes.length > 0) {
          const reportAttributes =
            attributes.map(({ field, value }) =>
              attributeRepository.create({
                report: savedReport,
                categoryField: field,
                value,
              }),
            );

          await attributeRepository.save(
            reportAttributes,
          );
        }

        return {
          id: savedReport.id,
          categoryId: category.id,
          reportType: savedReport.reportType,
          title: savedReport.title,
          eventDate: savedReport.eventDate,
          status: savedReport.status,
        };
      },
    );
  }

  async getOwnedReport(
    reportId: string,
    actorUserId: string,
  ): Promise<OwnedReportResult> {
    if (
      !isUUID(reportId) ||
      !isUUID(actorUserId)
    ) {
      throw new BadRequestException(
        "Invalid report or user UUID",
      );
    }

    const report = await this.reportRepository
      .createQueryBuilder("report")
      .addSelect("report.description")
      .innerJoinAndSelect(
        "report.user",
        "owner",
      )
      .innerJoinAndSelect(
        "report.category",
        "category",
      )
      .where(
        "report.id = :reportId",
        { reportId },
      )
      .getOne();

    if (!report) {
      throw new NotFoundException(
        "Report not found",
      );
    }

    if (report.user.id !== actorUserId) {
      throw new ForbiddenException(
        "You do not own this report",
      );
    }

    if (!report.user.isActive) {
      throw new ForbiddenException(
        "Inactive user cannot access reports",
      );
    }

    const areaRepository =
      this.reportRepository.manager.getRepository(
        ReportArea,
      );

    const attributeRepository =
      this.reportRepository.manager.getRepository(
        ReportAttribute,
      );

    const areas = await areaRepository.find({
      where: {
        report: { id: reportId },
      },
      order: {
        createdAt: "ASC",
        id: "ASC",
      },
    });

    const attributes =
      await attributeRepository.find({
        where: {
          report: { id: reportId },
        },
        relations: {
          categoryField: true,
        },
        order: {
          createdAt: "ASC",
          id: "ASC",
        },
      });

    return {
      id: report.id,
      categoryId: report.category.id,
      reportType: report.reportType,
      title: report.title,
      description: report.description,
      eventDate: report.eventDate,
      status: report.status,
      areas: areas.map((area) => ({
        areaName: area.areaName,
        specificPlace: area.specificPlace,
      })),
      attributes: attributes.map(
        (attribute) => ({
          categoryFieldId: attribute.categoryField.id,
          fieldKey: attribute.categoryField.fieldKey,
          value: attribute.value,
        }),
      ),
    };
  }
}
