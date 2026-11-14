
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import {
  Report,
  ReportStatus,
  ReportType,
} from "../reports/entities/report.entity";

import { ReportArea } from "../reports/entities/report-area.entity";
import { ReportAttribute } from "../reports/entities/report-attribute.entity";

import {
  calculateMatchScore,
  MatchArea,
  MatchAttribute,
  MatchScoreResult,
} from "./utils/match-score.util";

import {
  isEligibleMatchScore,
} from "./utils/match-policy.util";

export interface ScoredCandidate extends MatchScoreResult {
  foundReportId: string;
}

export interface MatchPersistenceResult {
  candidateCount: number;
  eligibleCount: number;
  excludedCount: number;
  writtenCount: number;
  unchangedOrLockedCount: number;
  removedCount: number;
}

@Injectable()
export class MatchesService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,
  ) {}

  // Phase 1: Candidate filtering
  async findCandidateIds(
    lostReportId: string,
  ): Promise<string[]> {
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

    if (lostReport.reportType !== ReportType.LOST) {
      throw new BadRequestException(
        "Matching requires a LOST report",
      );
    }

    if (lostReport.status !== ReportStatus.OPEN) {
      throw new BadRequestException(
        "Only OPEN reports can be matched",
      );
    }

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

    return candidates.map((candidate) => candidate.id);
  }

  // Phase 2: Database-integrated scoring
  async findScoredCandidates(
    lostReportId: string,
  ): Promise<ScoredCandidate[]> {
    const candidateIds =
      await this.findCandidateIds(lostReportId);

    if (candidateIds.length === 0) {
      return [];
    }

    const reportIds = [lostReportId, ...candidateIds];

    const reports = await this.reportRepository.findBy({
      id: In(reportIds),
    });

    const areaRepository =
      this.reportRepository.manager.getRepository(ReportArea);

    const attributeRepository =
      this.reportRepository.manager.getRepository(
        ReportAttribute,
      );

    const areas = await areaRepository.find({
      where: {
        report: {
          id: In(reportIds),
        },
      },
      relations: {
        report: true,
      },
    });

    const attributes = await attributeRepository.find({
      where: {
        report: {
          id: In(reportIds),
        },
      },
      relations: {
        report: true,
        categoryField: true,
      },
    });

    const reportMap = new Map(
      reports.map((report) => [report.id, report]),
    );

    const areasByReport = new Map<string, MatchArea[]>();

    for (const area of areas) {
      const reportId = area.report.id;
      const current = areasByReport.get(reportId) ?? [];

      current.push({
        areaName: area.areaName,
        specificPlace: area.specificPlace,
      });

      areasByReport.set(reportId, current);
    }

    const attributesByReport = new Map<
      string,
      MatchAttribute[]
    >();

    for (const attribute of attributes) {
      const reportId = attribute.report.id;

      const current =
        attributesByReport.get(reportId) ?? [];

      current.push({
        categoryFieldId: attribute.categoryField.id,
        value: attribute.value,
      });

      attributesByReport.set(reportId, current);
    }

    const lostReport = reportMap.get(lostReportId);

    if (!lostReport) {
      throw new NotFoundException("Report not found");
    }

    const results: ScoredCandidate[] = [];

    for (const foundReportId of candidateIds) {
      const foundReport = reportMap.get(foundReportId);

      if (!foundReport) {
        continue;
      }

      const score = calculateMatchScore({
        lostDate: lostReport.eventDate,
        foundDate: foundReport.eventDate,

        lostAreas:
          areasByReport.get(lostReportId) ?? [],

        foundAreas:
          areasByReport.get(foundReportId) ?? [],

        lostAttributes:
          attributesByReport.get(lostReportId) ?? [],

        foundAttributes:
          attributesByReport.get(foundReportId) ?? [],
      });

      results.push({
        foundReportId,
        ...score,
      });
    }

    // Highest score first
    return results.sort(
      (a, b) =>
        b.finalScore - a.finalScore ||
        a.foundReportId.localeCompare(b.foundReportId),
    );
  }

  // Phase 4: Return only eligible candidates
  async findEligibleCandidates(
    lostReportId: string,
  ): Promise<ScoredCandidate[]> {
    const candidates =
      await this.findScoredCandidates(lostReportId);

    return candidates.filter((candidate) =>
      isEligibleMatchScore(candidate.finalScore),
    );
  }

  // Phase 5: Persist scores and clean up stale matches
  async persistScoredCandidates(
    lostReportId: string,
  ): Promise<MatchPersistenceResult> {
    return this.reportRepository.manager.transaction(
      async (manager) => {
        const scopedService = new MatchesService(
          manager.getRepository(Report),
        );

        const candidates =
          await scopedService.findScoredCandidates(
            lostReportId,
          );

        const eligibleCandidates = candidates.filter(
          (candidate) =>
            isEligibleMatchScore(candidate.finalScore),
        );

        let writtenCount = 0;

        // Insert or update only eligible matches.
        for (const candidate of eligibleCandidates) {
          const rows: Array<{ id: string }> =
            await manager.query(
              `
              INSERT INTO public.matches
                (
                  lost_report_id,
                  found_report_id,
                  match_score
                )
              VALUES ($1, $2, $3)

              ON CONFLICT ON CONSTRAINT
                "UQ_matches_lost_found"

              DO UPDATE SET
                match_score = EXCLUDED.match_score,
                updated_at = NOW()

              WHERE matches.status = 'PENDING'
                AND matches.lost_confirmed = FALSE
                AND matches.found_confirmed = FALSE
                AND matches.match_score
                    IS DISTINCT FROM EXCLUDED.match_score

              RETURNING id
              `,
              [
                lostReportId,
                candidate.foundReportId,
                candidate.finalScore,
              ],
            );

          if (rows.length > 0) {
            writtenCount++;
          }
        }

        const eligibleIds = eligibleCandidates.map(
          (candidate) => candidate.foundReportId,
        );

        // Remove stale matches only if:
        // - Match is PENDING
        // - Neither owner has confirmed
        // - FOUND report is no longer eligible
        //
        // Preserve partially confirmed, confirmed
        // and rejected matches.

        // TypeORM PostgreSQL DELETE result format:
        // [deletedRows, affectedRowCount]
        const deletedResult: [
          Array<{ id: string }>,
          number,
        ] = await manager.query(
          `
          DELETE FROM public.matches
          WHERE lost_report_id = $1
            AND status = 'PENDING'
            AND lost_confirmed = FALSE
            AND found_confirmed = FALSE
            AND NOT (
              found_report_id = ANY($2::uuid[])
            )
          RETURNING id
          `,
          [lostReportId, eligibleIds],
        );

        // Count actual deleted rows, not the outer
        // TypeORM result array (which has 2 elements).
        const deletedRows = deletedResult[0];
        const removedCount = deletedRows.length;

        return {
          candidateCount: candidates.length,

          eligibleCount: eligibleCandidates.length,

          excludedCount:
            candidates.length - eligibleCandidates.length,

          writtenCount,

          unchangedOrLockedCount:
            eligibleCandidates.length - writtenCount,

          removedCount,
        };
      },
    );
  }
}
