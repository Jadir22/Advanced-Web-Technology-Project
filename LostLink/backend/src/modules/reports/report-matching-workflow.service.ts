
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";
import {
  EntityManager,
  Repository,
} from "typeorm";

import {
  Match,
  MatchStatus,
} from "../matches/entities/match.entity";

import {
  MatchesService,
} from "../matches/matches.service";

import {
  Report,
  ReportStatus,
  ReportType,
} from "./entities/report.entity";

import {
  CreateReportInput,
  CreatedReportResult,
  ReportsService,
} from "./reports.service";

interface IdRow {
  id: string;
}

@Injectable()
export class ReportMatchingWorkflowService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepository:
      Repository<Report>,
  ) {}

  // This is called by the real POST /reports API.
  //
  // Report creation, matching and notifications
  // participate in one outer database transaction.
  async createWithMatching(
    actorUserId: string,
    input: CreateReportInput,
  ): Promise<CreatedReportResult> {
    return this.reportRepository.manager.transaction(
      async (manager) => {
        // Reuse the existing report submission logic.
        // Its inner transaction uses a savepoint
        // when the repository is transaction-scoped.
        const reportsService = new ReportsService(
          manager.getRepository(Report),
        );

        const created =
          await reportsService.createReport(
            actorUserId,
            input,
          );

        await this.processCreatedReport(
          manager,
          created.id,
        );

        return created;
      },
    );
  }

  // Internal workflow method.
  // Safe to call again within a transaction.
  // This method is NOT a public HTTP endpoint.
  async processCreatedReport(
    manager: EntityManager,
    reportId: string,
  ): Promise<void> {
    if (!isUUID(reportId)) {
      throw new BadRequestException(
        "Invalid report UUID",
      );
    }

    const report = await manager
      .getRepository(Report)
      .findOne({
        where: {
          id: reportId,
        },
        relations: {
          category: true,
          user: true,
        },
      });

    if (!report) {
      throw new NotFoundException(
        "Report not found",
      );
    }

    if (report.status !== ReportStatus.OPEN) {
      throw new ConflictException(
        "Only OPEN reports can be matched",
      );
    }

    // Serialize automatic matching for one category.
    // Advisory lock is released when the transaction ends.
    await manager.query(
      `SELECT pg_advisory_xact_lock(
         hashtext($1::text),
         hashtext($2::text)
       )`,
      [
        "lostlink-report-matching",
        report.category.id,
      ],
    );

    const matchingService = new MatchesService(
      manager.getRepository(Report),
    );

    if (report.reportType === ReportType.LOST) {
      // Newly submitted LOST report:
      // compare it against existing FOUND reports.
      await matchingService.persistScoredCandidates(
        report.id,
      );
    } else if (
      report.reportType === ReportType.FOUND
    ) {
      // Newly submitted FOUND report:
      // find existing OPEN LOST reports in the
      // same category but with different owners.
      const lostReports: IdRow[] =
        await manager.query(
          `SELECT id
           FROM public.reports
           WHERE category_id = $1
             AND report_type = 'LOST'
             AND status = 'OPEN'
             AND user_id <> $2
           ORDER BY id`,
          [
            report.category.id,
            report.user.id,
          ],
        );

      for (const lost of lostReports) {
        await matchingService.persistScoredCandidates(
          lost.id,
        );
      }
    } else {
      throw new BadRequestException(
        "Unsupported report type",
      );
    }

    // Send notifications only for PENDING
    // matches involving the newly created report.
    //
    // All writes use the current transaction.
    // Re-processing skips existing notifications.
    await manager.query(
      `
      INSERT INTO public.notifications (
        user_id,
        match_id,
        type,
        title,
        body,
        is_read,
        read_at
      )

      SELECT
        recipient_user.id,
        match.id,
        'MATCH_FOUND'::public.notifications_type_enum,
        'Potential match found',
        'A possible match is available for one of your reports.',
        FALSE,
        NULL

      FROM public.matches match

      INNER JOIN public.reports lost_report
        ON lost_report.id = match.lost_report_id

      INNER JOIN public.reports found_report
        ON found_report.id = match.found_report_id

      CROSS JOIN LATERAL (
        VALUES
          (lost_report.user_id),
          (found_report.user_id)
      ) AS recipient(user_id)

      INNER JOIN public.users recipient_user
        ON recipient_user.id = recipient.user_id

      WHERE
        (
          ($2 = 'LOST' AND match.lost_report_id = $1)
          OR
          ($2 = 'FOUND' AND match.found_report_id = $1)
        )

        AND match.status = 'PENDING'
        AND match.lost_confirmed = FALSE
        AND match.found_confirmed = FALSE

        AND lost_report.status = 'OPEN'
        AND found_report.status = 'OPEN'

        AND lost_report.user_id <> found_report.user_id
        AND recipient_user.is_active = TRUE

        AND NOT EXISTS (
          SELECT 1
          FROM public.notifications existing
          WHERE existing.user_id = recipient_user.id
            AND existing.match_id = match.id
            AND existing.type = 'MATCH_FOUND'
        )
      `,
      [report.id, report.reportType],
    );
  }
}
