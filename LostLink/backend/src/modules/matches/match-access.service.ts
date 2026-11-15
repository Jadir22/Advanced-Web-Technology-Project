
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";
import { Repository } from "typeorm";

import { Report } from
  "../reports/entities/report.entity";

import {
  Match,
  MatchStatus,
} from "./entities/match.entity";

import { ListMatchesQueryDto } from
  "./dto/list-matches-query.dto";

export interface MatchSummary {
  id: string;
  lostReportId: string;
  foundReportId: string;
  matchScore: number;
  status: MatchStatus;
  lostConfirmed: boolean;
  foundConfirmed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedMatchesResult {
  matches: MatchSummary[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class MatchAccessService {
  constructor(
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,

    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,
  ) {}

  private validateIds(...ids: string[]): void {
    for (const id of ids) {
      if (!isUUID(id)) {
        throw new BadRequestException(
          "Invalid UUID",
        );
      }
    }
  }

  private toSummary(match: Match): MatchSummary {
    return {
      id: match.id,
      lostReportId: match.lostReport.id,
      foundReportId: match.foundReport.id,
      matchScore: Number(match.matchScore),
      status: match.status,
      lostConfirmed: match.lostConfirmed,
      foundConfirmed: match.foundConfirmed,
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
    };
  }

  // Validate that the requested report belongs
  // to the authenticated, active user.
  private async requireReportOwner(
    reportId: string,
    actorUserId: string,
  ): Promise<void> {
    this.validateIds(reportId, actorUserId);

    const report = await this.reportRepository.findOne({
      where: {
        id: reportId,
      },
      relations: {
        user: true,
      },
    });

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
        "Inactive user cannot access matches",
      );
    }
  }

  // Return matches only for a report owned
  // by the authenticated user.
  async listOwnedMatches(
    actorUserId: string,
    query: ListMatchesQueryDto,
  ): Promise<PaginatedMatchesResult> {
    await this.requireReportOwner(
      query.reportId,
      actorUserId,
    );

    const [matches, total] =
      await this.matchRepository.findAndCount({
        where: [
          {
            lostReport: {
              id: query.reportId,
            },
          },
          {
            foundReport: {
              id: query.reportId,
            },
          },
        ],
        relations: {
          lostReport: true,
          foundReport: true,
        },
        order: {
          createdAt: "DESC",
          id: "ASC",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });

    return {
      matches: matches.map((match) =>
        this.toSummary(match),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // Only the LOST or FOUND report owner
  // may view an individual match.
  async getOwnedMatch(
    matchId: string,
    actorUserId: string,
  ): Promise<MatchSummary> {
    this.validateIds(matchId, actorUserId);

    const match = await this.matchRepository.findOne({
      where: {
        id: matchId,
      },
      relations: {
        lostReport: {
          user: true,
        },
        foundReport: {
          user: true,
        },
      },
    });

    if (!match) {
      throw new NotFoundException(
        "Match not found",
      );
    }

    const lostOwner = match.lostReport.user;
    const foundOwner = match.foundReport.user;

    const ownsLost =
      lostOwner.id === actorUserId &&
      lostOwner.isActive;

    const ownsFound =
      foundOwner.id === actorUserId &&
      foundOwner.isActive;

    if (!ownsLost && !ownsFound) {
      throw new ForbiddenException(
        "You are not an owner of this match",
      );
    }

    return this.toSummary(match);
  }
}