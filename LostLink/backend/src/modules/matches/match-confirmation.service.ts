import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";
import { Repository } from "typeorm";

import { Match, MatchStatus } from "./entities/match.entity";
import {
  ReportStatus,
  ReportType,
} from "../reports/entities/report.entity";

export type MatchDecision = "CONFIRM" | "REJECT";

export interface MatchDecisionResult {
  matchId: string;
  status: MatchStatus;
  lostConfirmed: boolean;
  foundConfirmed: boolean;
}

interface MatchOwnershipRow {
  id: string;
  status: MatchStatus;
  lostReportId: string;
  foundReportId: string;
  lostConfirmed: boolean;
  foundConfirmed: boolean;
  lostOwnerId: string;
  foundOwnerId: string;
  lostOwnerActive: boolean;
  foundOwnerActive: boolean;
  lostReportStatus: ReportStatus;
  foundReportStatus: ReportStatus;
  lostReportType: ReportType;
  foundReportType: ReportType;
  lostCategoryId: string;
  foundCategoryId: string;
}

@Injectable()
export class MatchConfirmationService {
  constructor(
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,
  ) {}

  async recordDecision(
    matchId: string,
    actorUserId: string,
    decision: MatchDecision,
  ): Promise<MatchDecisionResult> {
    if (!isUUID(matchId) || !isUUID(actorUserId)) {
      throw new BadRequestException("Invalid UUID");
    }
    if (decision !== "CONFIRM" && decision !== "REJECT") {
      throw new BadRequestException("Invalid decision");
    }

    return this.matchRepository.manager.transaction(async (manager) => {
      // Use the SAME category advisory lock as report auto-matching.
      // It serializes two competing confirmations and new report matching.
      const hints: Array<{ categoryId: string }> = await manager.query(
        `SELECT lr.category_id AS "categoryId"
         FROM public.matches m
         JOIN public.reports lr ON lr.id = m.lost_report_id
         WHERE m.id = $1`,
        [matchId],
      );
      if (!hints[0]) {
        throw new NotFoundException("Match not found");
      }
      await manager.query(
        `SELECT pg_advisory_xact_lock(
           hashtext($1::text), hashtext($2::text)
         )`,
        ["lostlink-report-matching", hints[0].categoryId],
      );

      // Read all authoritative state AFTER obtaining the lock.
      const rows: MatchOwnershipRow[] = await manager.query(
        `SELECT
           m.id, m.status,
           m.lost_report_id AS "lostReportId",
           m.found_report_id AS "foundReportId",
           m.lost_confirmed AS "lostConfirmed",
           m.found_confirmed AS "foundConfirmed",
           lr.user_id AS "lostOwnerId",
           fr.user_id AS "foundOwnerId",
           lu.is_active AS "lostOwnerActive",
           fu.is_active AS "foundOwnerActive",
           lr.status AS "lostReportStatus",
           fr.status AS "foundReportStatus",
           lr.report_type AS "lostReportType",
           fr.report_type AS "foundReportType",
           lr.category_id AS "lostCategoryId",
           fr.category_id AS "foundCategoryId"
         FROM public.matches m
         JOIN public.reports lr ON lr.id = m.lost_report_id
         JOIN public.reports fr ON fr.id = m.found_report_id
         JOIN public.users lu ON lu.id = lr.user_id
         JOIN public.users fu ON fu.id = fr.user_id
         WHERE m.id = $1
         FOR UPDATE OF m, lr, fr, lu, fu`,
        [matchId],
      );
      const match = rows[0];
      if (!match) {
        throw new NotFoundException("Match not found");
      }

      const isLostOwner = match.lostOwnerId === actorUserId;
      const isFoundOwner = match.foundOwnerId === actorUserId;
      if (!isLostOwner && !isFoundOwner) {
        throw new ForbiddenException("You are not an owner of this match");
      }
      if (!match.lostOwnerActive || !match.foundOwnerActive) {
        throw new ForbiddenException("Both match participants must be active");
      }
      if (match.lostOwnerId === match.foundOwnerId) {
        throw new ConflictException("Both reports have the same owner");
      }
      if (
        match.lostReportType !== ReportType.LOST ||
        match.foundReportType !== ReportType.FOUND
      ) {
        throw new ConflictException("Match must contain LOST and FOUND reports");
      }
      if (match.lostCategoryId !== match.foundCategoryId) {
        throw new ConflictException("Matched reports must share a category");
      }
      if (match.status !== MatchStatus.PENDING) {
        throw new ConflictException("Match is already finalized");
      }
      if (
        match.lostReportStatus !== ReportStatus.OPEN ||
        match.foundReportStatus !== ReportStatus.OPEN
      ) {
        throw new ConflictException("Both reports must be OPEN");
      }

      // Repeating one owner's partial confirmation is idempotent.
      if (
        decision === "CONFIRM" &&
        ((isLostOwner && match.lostConfirmed) ||
          (isFoundOwner && match.foundConfirmed))
      ) {
        return {
          matchId,
          status: match.status,
          lostConfirmed: match.lostConfirmed,
          foundConfirmed: match.foundConfirmed,
        };
      }

      const lostConfirmed = match.lostConfirmed ||
        (decision === "CONFIRM" && isLostOwner);
      const foundConfirmed = match.foundConfirmed ||
        (decision === "CONFIRM" && isFoundOwner);
      const nextStatus = decision === "REJECT"
        ? MatchStatus.REJECTED
        : lostConfirmed && foundConfirmed
          ? MatchStatus.CONFIRMED
          : MatchStatus.PENDING;

      if (nextStatus === MatchStatus.CONFIRMED) {
        // Never allow one report to belong to two confirmed matches.
        const duplicates: Array<{ id: string }> = await manager.query(
          `SELECT id FROM public.matches
           WHERE id <> $1 AND status = 'CONFIRMED'
             AND (
               lost_report_id IN ($2, $3)
               OR found_report_id IN ($2, $3)
             ) LIMIT 1`,
          [matchId, match.lostReportId, match.foundReportId],
        );
        if (duplicates.length) {
          throw new ConflictException("Another match is already confirmed");
        }
      }

      const updated: [Array<{
        status: MatchStatus;
        lostConfirmed: boolean;
        foundConfirmed: boolean;
      }>, number] = await manager.query(
        `UPDATE public.matches
         SET lost_confirmed = $2,
             found_confirmed = $3,
             status = $4::public.matches_status_enum,
             updated_at = NOW()
         WHERE id = $1
         RETURNING status,
                   lost_confirmed AS "lostConfirmed",
                   found_confirmed AS "foundConfirmed"`,
        [matchId, lostConfirmed, foundConfirmed, nextStatus],
      );
      const result = updated[0][0];
      if (!result) {
        throw new Error("Match update did not return a row");
      }

      if (nextStatus === MatchStatus.CONFIRMED) {
        // Report lifecycle, competitor cleanup and notifications are atomic.
        const reportsUpdated: [Array<{ id: string }>, number] =
          await manager.query(
            `UPDATE public.reports
             SET status = 'RESOLVED'::public.reports_status_enum,
                 updated_at = NOW()
             WHERE id IN ($1, $2) AND status = 'OPEN'
             RETURNING id`,
            [match.lostReportId, match.foundReportId],
          );
        if (reportsUpdated[0].length !== 2) {
          throw new ConflictException("Could not resolve both reports");
        }

        // Preserve competing matches as REJECTED history; never DELETE.
        // Preserve their partial confirmation flags for audit/history.
        await manager.query(
          `UPDATE public.matches
           SET status = 'REJECTED'::public.matches_status_enum,
               updated_at = NOW()
           WHERE id <> $1 AND status = 'PENDING'
             AND (
               lost_report_id IN ($2, $3)
               OR found_report_id IN ($2, $3)
             )`,
          [matchId, match.lostReportId, match.foundReportId],
        );

        // Same transaction. Duplicate notifications are prevented by
        // the locked/finalized match and the NOT EXISTS condition.
        await manager.query(
          `INSERT INTO public.notifications
            (user_id, match_id, type, title, body, is_read, read_at)
           SELECT recipient.user_id, $1::uuid,
                  'MATCH_CONFIRMED'::public.notifications_type_enum,
                  'Match confirmed',
                  'Both report owners have confirmed a match.',
                  FALSE, NULL
           FROM (VALUES ($2::uuid), ($3::uuid)) AS recipient(user_id)
           WHERE NOT EXISTS (
             SELECT 1 FROM public.notifications n
             WHERE n.user_id = recipient.user_id
               AND n.match_id = $1::uuid
               AND n.type = 'MATCH_CONFIRMED'
           )`,
          [matchId, match.lostOwnerId, match.foundOwnerId],
        );
      }

      return {
        matchId,
        status: result.status,
        lostConfirmed: result.lostConfirmed,
        foundConfirmed: result.foundConfirmed,
      };
    });
  }
}
