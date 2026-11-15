
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";

import {
  FindOptionsWhere,
  Repository,
} from "typeorm";

import {
  Match,
  MatchStatus,
} from "../matches/entities/match.entity";

import { User } from
  "../users/entities/user.entity";

import {
  Report,
  ReportStatus,
  ReportType,
} from "./entities/report.entity";

import {
  MyReportsQueryDto,
} from "./dto/manage-reports.dto";

export interface MyReportItem {
  id: string;
  categoryId: string;
  reportType: ReportType;
  title: string;
  eventDate: string;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MyReportsResult {
  reports: MyReportItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ReportSummaryResult {
  total: number;
  open: number;
  resolved: number;
  cancelled: number;
}

@Injectable()
export class ReportManagementService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepository:
      Repository<Report>,

    @InjectRepository(User)
    private readonly userRepository:
      Repository<User>,
  ) {}

  private validateId(id: string): void {
    if (
      typeof id !== "string" ||
      !isUUID(id)
    ) {
      throw new BadRequestException(
        "Invalid UUID",
      );
    }
  }

  private async requireActiveUser(
    userId: string,
  ): Promise<void> {
    this.validateId(userId);

    const user =
      await this.userRepository.findOne({
        where: {
          id: userId,
          isActive: true,
        },
      });

    if (!user) {
      throw new ForbiddenException(
        "Active user required",
      );
    }
  }

  private toItem(
    report: Report,
  ): MyReportItem {
    return {
      id: report.id,
      categoryId: report.category.id,
      reportType: report.reportType,
      title: report.title,
      eventDate: report.eventDate,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }

  // Return only reports owned by the current user.
  async listMine(
    actorUserId: string,
    query: MyReportsQueryDto,
  ): Promise<MyReportsResult> {
    await this.requireActiveUser(actorUserId);

    const where: FindOptionsWhere<Report> = {
      user: {
        id: actorUserId,
      },
    };

    if (query.type) {
      where.reportType = query.type;
    }

    if (query.status) {
      where.status = query.status;
    }

    const [reports, total] =
      await this.reportRepository.findAndCount({
        where,
        relations: {
          category: true,
        },
        order: {
          createdAt: "DESC",
          id: "DESC",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });

    return {
      reports: reports.map(
        (report) => this.toItem(report),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // Counts only the actor's own reports.
  async summary(
    actorUserId: string,
  ): Promise<ReportSummaryResult> {
    await this.requireActiveUser(actorUserId);

    const rows =
      await this.reportRepository
        .createQueryBuilder("report")
        .select(
          "report.status",
          "status",
        )
        .addSelect(
          "COUNT(report.id)",
          "count",
        )
        .where(
          "report.user_id = :actorUserId",
          { actorUserId },
        )
        .groupBy("report.status")
        .getRawMany<{
          status: ReportStatus;
          count: string;
        }>();

    const counts: Record<
      ReportStatus,
      number
    > = {
      [ReportStatus.OPEN]: 0,
      [ReportStatus.RESOLVED]: 0,
      [ReportStatus.CANCELLED]: 0,
    };

    for (const row of rows) {
      if (row.status in counts) {
        counts[row.status] =
          Number(row.count);
      }
    }

    return {
      total:
        counts.OPEN +
        counts.RESOLVED +
        counts.CANCELLED,
      open: counts.OPEN,
      resolved: counts.RESOLVED,
      cancelled: counts.CANCELLED,
    };
  }

  // Owner-initiated cancellation or resolution.
  // Automatic resolution after match confirmation
  // belongs to the later JM-07 integration task.
  async changeStatus(
    reportId: string,
    actorUserId: string,
    targetStatus:
      | ReportStatus.CANCELLED
      | ReportStatus.RESOLVED,
  ): Promise<MyReportItem> {
    this.validateId(reportId);

    await this.requireActiveUser(
      actorUserId,
    );

    if (
      targetStatus !==
        ReportStatus.CANCELLED &&
      targetStatus !==
        ReportStatus.RESOLVED
    ) {
      throw new BadRequestException(
        "Status must be CANCELLED or RESOLVED",
      );
    }

    return this.reportRepository.manager.transaction(
      async (manager) => {
        // Lock report against concurrent
        // owner-initiated status changes.
        const report =
          await manager
            .getRepository(Report)
            .createQueryBuilder("report")
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
            .setLock(
              "pessimistic_write",
              undefined,
              ["report"],
            )
            .getOne();

        if (!report) {
          throw new NotFoundException(
            "Report not found",
          );
        }

        if (
          report.user.id !== actorUserId
        ) {
          throw new ForbiddenException(
            "You do not own this report",
          );
        }

        if (!report.user.isActive) {
          throw new ForbiddenException(
            "Inactive user cannot manage reports",
          );
        }

        // Same status can be requested again.
        if (
          report.status === targetStatus
        ) {
          return this.toItem(report);
        }

        // No reopening or terminal-to-terminal
        // status changes.
        if (
          report.status !==
          ReportStatus.OPEN
        ) {
          throw new ConflictException(
            "Only OPEN reports can change status",
          );
        }

        // PENDING and CONFIRMED matches block
        // manual status changes.
        const blockingMatches =
          await manager
            .getRepository(Match)
            .createQueryBuilder("match")
            .where(
              `(match.lost_report_id = :reportId
                OR match.found_report_id = :reportId)`,
              { reportId },
            )
            .andWhere(
              "match.status IN (:...statuses)",
              {
                statuses: [
                  MatchStatus.PENDING,
                  MatchStatus.CONFIRMED,
                ],
              },
            )
            .getCount();

        if (blockingMatches > 0) {
          throw new ConflictException(
            "Report has an active match; resolve the match workflow first",
          );
        }

        report.status = targetStatus;

        const saved =
          await manager
            .getRepository(Report)
            .save(report);

        return this.toItem(saved);
      },
    );
  }
}
