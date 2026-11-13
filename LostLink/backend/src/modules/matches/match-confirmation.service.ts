
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { isUUID } from "class-validator";

import {
    Match,
    MatchStatus,
} from "./entities/match.entity";

import { ReportStatus } from
    "../reports/entities/report.entity";

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
    lostConfirmed: boolean;
    foundConfirmed: boolean;
    lostOwnerId: string;
    foundOwnerId: string;
    lostReportStatus: ReportStatus;
    foundReportStatus: ReportStatus;
}

@Injectable()
export class MatchConfirmationService {
    constructor(
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
    ) { }

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

        return this.matchRepository.manager.transaction(
            async (manager) => {
                // Lock the match row to serialize decisions.
                const rows: MatchOwnershipRow[] =
                    await manager.query(
                        `
            SELECT
              m.id,
              m.status,
              m.lost_confirmed AS "lostConfirmed",
              m.found_confirmed AS "foundConfirmed",
              lr.user_id AS "lostOwnerId",
              fr.user_id AS "foundOwnerId",
              lr.status AS "lostReportStatus",
              fr.status AS "foundReportStatus"
            FROM public.matches m
            INNER JOIN public.reports lr
              ON lr.id = m.lost_report_id
            INNER JOIN public.reports fr
              ON fr.id = m.found_report_id
            WHERE m.id = $1
            FOR UPDATE OF m
            `,
                        [matchId],
                    );

                const match = rows[0];

                if (!match) {
                    throw new NotFoundException("Match not found");
                }

                // Confirmations must come from report owners.
                const isLostOwner =
                    match.lostOwnerId === actorUserId;

                const isFoundOwner =
                    match.foundOwnerId === actorUserId;

                if (!isLostOwner && !isFoundOwner) {
                    throw new ForbiddenException(
                        "You are not an owner of this match",
                    );
                }

                if (match.lostOwnerId === match.foundOwnerId) {
                    throw new ConflictException(
                        "Both reports have the same owner",
                    );
                }

                // Terminal matches cannot be changed.
                if (match.status !== MatchStatus.PENDING) {
                    throw new ConflictException(
                        "Match is already finalized",
                    );
                }

                if (
                    match.lostReportStatus !== ReportStatus.OPEN ||
                    match.foundReportStatus !== ReportStatus.OPEN
                ) {
                    throw new ConflictException(
                        "Both reports must be OPEN",
                    );
                }

                let lostConfirmed = match.lostConfirmed;
                let foundConfirmed = match.foundConfirmed;
                let nextStatus = MatchStatus.PENDING;

                if (decision === "REJECT") {
                    nextStatus = MatchStatus.REJECTED;
                } else {
                    if (isLostOwner) {
                        lostConfirmed = true;
                    }

                    if (isFoundOwner) {
                        foundConfirmed = true;
                    }

                    if (lostConfirmed && foundConfirmed) {
                        nextStatus = MatchStatus.CONFIRMED;
                    }
                }


                const updated: [
                    Array<{
                        status: MatchStatus;
                        lostConfirmed: boolean;
                        foundConfirmed: boolean;
                    }>,
                    number,
                ] = await manager.query(

                    `
          UPDATE public.matches
          SET
            lost_confirmed = $2,
            found_confirmed = $3,
            status = $4::public.matches_status_enum,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            status,
            lost_confirmed AS "lostConfirmed",
            found_confirmed AS "foundConfirmed"
          `,
                    [
                        matchId,
                        lostConfirmed,
                        foundConfirmed,
                        nextStatus,
                    ],
                );


                const updatedRow = updated[0][0];

                if (!updatedRow) {
                    throw new Error("Match update returned no row");
                }

                return {
                    matchId,
                    status: updatedRow.status,
                    lostConfirmed: updatedRow.lostConfirmed,
                    foundConfirmed: updatedRow.foundConfirmed,
                };
            },
        );
    }
}
