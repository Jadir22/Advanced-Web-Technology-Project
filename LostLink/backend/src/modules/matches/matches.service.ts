
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import {
  Report,
  ReportStatus,
  ReportType,
} from "../reports/entities/report.entity";

@Injectable()
export class MatchesService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,
  ) {}

  async findCandidateIds(lostReportId: string): Promise<string[]> {
    // Step 1: Find the original lost report
    const lostReport = await this.reportRepository.findOne({
      where: { id: lostReportId },
      relations: {
        category: true,
        user: true,
      },
    });

    if (!lostReport) {
      throw new NotFoundException("Report not found");
    }

    // Step 2: Validate report type
    if (lostReport.reportType !== ReportType.LOST) {
      throw new BadRequestException(
        "Matching requires a LOST report",
      );
    }

    // Step 3: Validate report status
    if (lostReport.status !== ReportStatus.OPEN) {
      throw new BadRequestException(
        "Only OPEN reports can be matched",
      );
    }

    // Step 4: Find suitable FOUND reports
    const candidates = await this.reportRepository
      .createQueryBuilder("candidate")
      .innerJoin("candidate.category", "category")
      .innerJoin("candidate.user", "owner")
      .select("candidate.id", "id")
      .where("candidate.reportType = :type", {
        type: ReportType.FOUND,
      })
      .andWhere("candidate.status = :status", {
        status: ReportStatus.OPEN,
      })
      .andWhere("category.id = :categoryId", {
        categoryId: lostReport.category.id,
      })
      .andWhere("owner.id <> :userId", {
        userId: lostReport.user.id,
      })
      .andWhere("candidate.id <> :lostReportId", {
        lostReportId,
      })
      .orderBy("candidate.eventDate", "DESC")
      .addOrderBy("candidate.id", "ASC")
      .getRawMany<{ id: string }>();

    // Step 5: Return candidate IDs only
    return candidates.map((candidate) => candidate.id);
  }
}
